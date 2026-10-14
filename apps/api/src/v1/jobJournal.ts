import { randomUUID } from "node:crypto";
import { constants, closeSync, existsSync, fsyncSync, mkdirSync, openSync,
  readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import type { Job } from "./ports";

const MAX_JOBS = 256;
const MAX_BYTES = 1024 * 1024;
const terminal = (job: Job) =>
  job.state === "succeeded" || job.state === "failed" || job.state === "unknown";

export const defaultJobJournalPath = (): string => {
  const override = process.env.UTM_API_JOB_JOURNAL_PATH;
  if (override && !isAbsolute(override))
    throw new Error("UTM_API_JOB_JOURNAL_PATH must be absolute and outside the repository");
  return resolve(override ||
    join(homedir(), "Library", "Application Support", "UTM Web", "api-jobs.json"));
};

export class JournalError extends Error {
  readonly code = "service_unavailable";
  constructor(message: string) { super(message); }
}

/** Synchronous atomic snapshots keep admission and state changes ordered. */
export class JobJournal {
  private jobs = new Map<string, Job>();
  private readonly lockPath: string;
  private readonly lockToken = randomUUID();
  private owned = false;

  constructor(readonly path: string = defaultJobJournalPath()) {
    this.lockPath = `${path}.lock`;
    try {
      const repositoryRoot = resolve(__dirname, "../../../..");
      if (!isAbsolute(path) || path === repositoryRoot || path.startsWith(repositoryRoot + sep))
        throw new Error("journal path must be absolute and outside the repository");
      this.acquire();
      if (existsSync(path)) {
        if (statSync(path).size > MAX_BYTES) throw new Error("journal exceeds size limit");
        const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
        this.jobs = this.parse(parsed);
      }
      const recovered = new Map(this.jobs);
      let interrupted = false;
      for (const [id, job] of recovered) {
        if (job.state === "queued" || job.state === "running") {
          recovered.set(id, {
            id, state: "unknown", error: {
              code: "outcome_unknown",
              message: "API interrupted; inspect refreshed VM state before another action",
            },
          });
          interrupted = true;
        }
      }
      if (interrupted) this.commit(recovered);
    } catch (error) {
      this.close();
      throw new JournalError("Cannot load or recover the API job journal: " + String(error));
    }
  }

  isOwned(): boolean {
    if (!this.owned) return false;
    try {
      const lock = JSON.parse(readFileSync(this.lockPath, "utf8")) as { token?: string };
      return lock.token === this.lockToken;
    } catch { return false; }
  }

  close(): void {
    if (!this.owned) return;
    if (this.isOwned()) unlinkSync(this.lockPath);
    this.owned = false;
  }

  private acquire(): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const payload = JSON.stringify({ pid: process.pid, token: this.lockToken });
    const create = () => {
      const file = openSync(this.lockPath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
      try { writeFileSync(file, payload); fsyncSync(file); }
      catch (error) { unlinkSync(this.lockPath); throw error; }
      finally { closeSync(file); }
      this.owned = true;
    };
    try { create(); return; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    // One reclaimer at a time prevents two starters from both removing a stale lock.
    const reclaimPath = `${this.lockPath}.reclaim`;
    const reclaim = openSync(reclaimPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    try {
      const owner = JSON.parse(readFileSync(this.lockPath, "utf8")) as { pid?: unknown; token?: unknown };
      if (!Number.isInteger(owner.pid) || (owner.pid as number) < 1 ||
          typeof owner.token !== "string")
        throw new Error("invalid journal lock; inspect it before removal");
      try {
        process.kill(owner.pid as number, 0);
        throw new Error("journal is already owned by a running API process");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
      unlinkSync(this.lockPath);
      create();
    } finally {
      closeSync(reclaim);
      unlinkSync(reclaimPath);
    }
  }

  get(id: string): Job | null { return this.jobs.get(id) ?? null; }

  insert(job: Job): void {
    const next = new Map(this.jobs);
    next.set(job.id, job);
    for (const [id, previous] of next) {
      if (next.size <= MAX_JOBS) break;
      if (terminal(previous)) next.delete(id);
    }
    if (next.size > MAX_JOBS) throw new JournalError("API job journal is full");
    this.commit(next);
  }

  update(job: Job): void {
    if (!this.jobs.has(job.id)) throw new JournalError("API job is absent from journal");
    const next = new Map(this.jobs);
    next.set(job.id, job);
    this.commit(next);
  }

  private parse(value: unknown): Map<string, Job> {
    const data = value as { version?: unknown; jobs?: unknown } | null;
    if (!data || data.version !== 1 || !Array.isArray(data.jobs) || data.jobs.length > MAX_JOBS)
      throw new Error("invalid journal format");
    const jobs = new Map<string, Job>();
    for (const item of data.jobs) {
      const job = item as Job | null;
      if (!job || typeof job.id !== "string" ||
          !/^[0-9a-fA-F-]{36}$/.test(job.id) ||
          !["queued", "running", "succeeded", "failed", "unknown"].includes(job.state) ||
          (job.state === "succeeded" && (job.result === undefined || job.error !== undefined)) ||
          (["failed", "unknown"].includes(job.state) &&
            (!job.error || typeof job.error.code !== "string" ||
              typeof job.error.message !== "string" || job.result !== undefined)) ||
          (["queued", "running"].includes(job.state) &&
            (job.error !== undefined || job.result !== undefined)) || jobs.has(job.id))
        throw new Error("invalid journal job");
      jobs.set(job.id, job);
    }
    return jobs;
  }

  private commit(next: Map<string, Job>): void {
    if (!this.isOwned()) throw new JournalError("API job journal ownership lost");
    const payload = JSON.stringify({ version: 1, jobs: [...next.values()] });
    if (Buffer.byteLength(payload) > MAX_BYTES)
      throw new JournalError("API job journal exceeds size limit");
    const directory = dirname(this.path);
    const temporary = join(directory, `.api-jobs-${randomUUID()}.tmp`);
    let file: number | undefined;
    try {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      file = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
      writeFileSync(file, payload);
      fsyncSync(file);
      closeSync(file);
      file = undefined;
      renameSync(temporary, this.path);
      const dir = openSync(directory, constants.O_RDONLY);
      try { fsyncSync(dir); } finally { closeSync(dir); }
      this.jobs = next;
    } catch (error) {
      if (file !== undefined) closeSync(file);
      try { unlinkSync(temporary); } catch { /* rename may already have consumed it */ }
      throw new JournalError("Cannot persist the API job journal: " + String(error));
    }
  }
}
