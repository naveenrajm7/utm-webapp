import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** The adapter boundary. An integration adapter must return a newly created UUID from cloneVm. */
export interface UtmPort {
  listVms(): Promise<UtmVm[]>;
  getVm(id: string): Promise<UtmVm>;
  cloneVm(templateId: string, name: string): Promise<UtmVm>;
  configureVm(vmId: string, configuration: { network?: NetworkPreset }): Promise<UtmVm>;
  startVm(vmId: string): Promise<void>;
  stopVm(vmId: string): Promise<void>;
  deleteVm(vmId: string): Promise<void>;
  execInGuest(vmId: string, argv: string[], options?: { timeoutMs?: number }): Promise<ExecResult>;
}

export interface UtmVm {
  id: string;
  name: string;
  status?: string;
  capabilities?: { guestExec?: boolean; guestExecution?: boolean };
}
export type NetworkPreset = "offline" | "shared";
export interface ExecResult { stdout: string; stderr: string; exitCode: number }
export type JobState = "queued" | "running" | "succeeded" | "failed";
export type JobKind = "create" | "exec" | "destroy";
export type SandboxState = "creating" | "ready" | "destroying" | "destroyed" | "failed" | "cleanup_failed";
export type ErrorCode = "invalid_argument" | "not_found" | "not_managed" | "conflict" | "unsupported" | "utm_failure" | "interrupted";

export class SandboxServiceError extends Error {
  constructor(public readonly code: ErrorCode, message: string) {
    super(message);
    this.name = "SandboxServiceError";
  }
}
export interface Template { id: string; name: string; approvedAt: string }
export interface Sandbox {
  id: string;
  templateId: string;
  vmId: string | null;
  network: NetworkPreset;
  state: SandboxState;
  createdAt: string;
  leaseExpiresAt: string;
  error: string | null;
}
export interface Job {
  id: string;
  sandboxId: string;
  kind: JobKind;
  state: JobState;
  result: ExecResult | { sandboxId: string; vmId?: string } | null;
  error: { code: ErrorCode; message: string } | null;
  createdAt: string;
  updatedAt: string;
}

// node:sqlite is bundled with Node 22.13+; local structural types avoid requiring
// a newer @types/node in the monorepo's shared lockfile.
type SqlValue = string | number | null;
interface Statement {
  get(...values: SqlValue[]): unknown;
  all(...values: SqlValue[]): unknown[];
  run(...values: SqlValue[]): unknown;
}
interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close(): void;
}
interface TemplateRow { id: string; name: string; approved_at: number }
interface SandboxRow {
  id: string; template_id: string; vm_id: string | null; network: NetworkPreset;
  state: SandboxState; managed: number; created_at: number; lease_expires_at: number; error: string | null;
}
interface JobRow {
  id: string; sandbox_id: string; kind: JobKind; state: JobState;
  result_json: string | null; error_json: string | null; created_at: number; updated_at: number;
}

export interface SandboxServiceOptions {
  dbPath: string;
  port: UtmPort;
  now?: () => number;
  sweepIntervalMs?: number;
}

export class SandboxService {
  private readonly db: SqliteDb;
  private readonly port: UtmPort;
  private readonly now: () => number;
  private readonly sweepIntervalMs: number;
  private readonly pending = new Set<Promise<void>>();
  private readonly activeSandboxes = new Set<string>();
  private timer: NodeJS.Timeout | undefined;
  private started = false;
  private closed = false;

  constructor(options: SandboxServiceOptions) {
    this.port = options.port;
    this.now = options.now ?? Date.now;
    this.sweepIntervalMs = options.sweepIntervalMs ?? 30_000;
    if (!options.dbPath) throw new SandboxServiceError("invalid_argument", "dbPath is required");
    if (options.dbPath !== ":memory:") mkdirSync(dirname(options.dbPath), { recursive: true });
    const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: new (path: string) => SqliteDb };
    this.db = new DatabaseSync(options.dbPath);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS templates (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, approved_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sandboxes (
        id TEXT PRIMARY KEY, template_id TEXT NOT NULL, vm_id TEXT UNIQUE,
        network TEXT NOT NULL CHECK(network IN ('offline','shared')),
        state TEXT NOT NULL, managed INTEGER NOT NULL DEFAULT 0 CHECK(managed IN (0,1)),
        created_at INTEGER NOT NULL, lease_expires_at INTEGER NOT NULL, error TEXT
      );
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY, sandbox_id TEXT NOT NULL REFERENCES sandboxes(id),
        kind TEXT NOT NULL, state TEXT NOT NULL, result_json TEXT, error_json TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS jobs_sandbox ON jobs(sandbox_id);
      CREATE INDEX IF NOT EXISTS sandboxes_lease ON sandboxes(state, lease_expires_at);
    `);
  }

  async start(): Promise<void> {
    this.assertOpen();
    if (this.started) return;
    this.started = true;
    await this.reconcile(true);
    if (this.sweepIntervalMs > 0) {
      this.timer = setInterval(() => { void this.reconcile().catch(() => undefined); }, this.sweepIntervalMs);
      this.timer.unref();
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    if (this.timer) clearInterval(this.timer);
    await this.waitForIdle();
    this.db.close();
    this.closed = true;
  }

  async waitForIdle(): Promise<void> {
    while (this.pending.size) await Promise.all([...this.pending]);
  }

  async approveTemplate(id: string): Promise<Template> {
    this.assertStarted();
    this.requireId(id);
    const vm = await this.getVmOrNull(id);
    if (!vm) throw new SandboxServiceError("not_found", "Template VM does not exist");
    if (vm.id.toLowerCase() !== id.toLowerCase()) throw new SandboxServiceError("utm_failure", "UTM returned a mismatched template ID");
    const at = this.now();
    this.db.prepare("INSERT INTO templates(id,name,approved_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, approved_at=excluded.approved_at").run(id, vm.name, at);
    return { id, name: vm.name, approvedAt: new Date(at).toISOString() };
  }

  revokeTemplate(id: string): void {
    this.assertStarted();
    this.requireId(id);
    this.db.prepare("DELETE FROM templates WHERE id=?").run(id);
  }

  listTemplates(): Template[] {
    this.assertStarted();
    return (this.db.prepare("SELECT * FROM templates ORDER BY name,id").all() as TemplateRow[]).map(row => ({
      id: row.id, name: row.name, approvedAt: new Date(row.approved_at).toISOString()
    }));
  }

  getSandbox(id: string): Sandbox | null {
    this.assertStarted();
    const row = this.findSandbox(id);
    return row ? this.toSandbox(row) : null;
  }

  getJob(id: string): Job | null {
    this.assertStarted();
    const row = this.db.prepare("SELECT * FROM jobs WHERE id=?").get(id) as JobRow | undefined;
    if (!row) return null;
    return {
      id: row.id, sandboxId: row.sandbox_id, kind: row.kind, state: row.state,
      result: row.result_json ? JSON.parse(row.result_json) as Job["result"] : null,
      error: row.error_json ? JSON.parse(row.error_json) as Job["error"] : null,
      createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString()
    };
  }

  async createSandbox(input: { templateId: string; network: NetworkPreset; ttlSeconds: number }): Promise<{ sandboxId: string; jobId: string }> {
    this.assertStarted();
    this.requireId(input.templateId);
    if (input.network !== "offline" && input.network !== "shared") throw new SandboxServiceError("invalid_argument", "network must be offline or shared");
    if (!Number.isSafeInteger(input.ttlSeconds) || input.ttlSeconds < 1 || input.ttlSeconds > 86_400) {
      throw new SandboxServiceError("invalid_argument", "ttlSeconds must be an integer from 1 to 86400");
    }
    const template = this.db.prepare("SELECT * FROM templates WHERE id=?").get(input.templateId) as TemplateRow | undefined;
    if (!template) throw new SandboxServiceError("invalid_argument", "Template is not approved");
    if (!await this.getVmOrNull(input.templateId)) throw new SandboxServiceError("not_found", "Template VM no longer exists");
    const sandboxId = randomUUID();
    const jobId = randomUUID();
    const at = this.now();
    this.transaction(() => {
      this.db.prepare("INSERT INTO sandboxes(id,template_id,network,state,created_at,lease_expires_at) VALUES(?,?,?,?,?,?)")
        .run(sandboxId, input.templateId, input.network, "creating", at, at + input.ttlSeconds * 1000);
      this.insertJob(jobId, sandboxId, "create", at);
    });
    this.launch(sandboxId, jobId, async () => this.runCreate(sandboxId));
    return { sandboxId, jobId };
  }

  executeSandbox(id: string, input: { argv: string[]; timeoutSeconds?: number }): { jobId: string } {
    this.assertStarted();
    if (!Array.isArray(input.argv) || input.argv.length === 0 || input.argv.length > 128 ||
        input.argv.some(arg => typeof arg !== "string" || arg.length === 0 || arg.length > 8192)) {
      throw new SandboxServiceError("invalid_argument", "argv must contain 1 to 128 nonempty strings");
    }
    if (input.timeoutSeconds !== undefined && (!Number.isSafeInteger(input.timeoutSeconds) || input.timeoutSeconds < 1 || input.timeoutSeconds > 300)) {
      throw new SandboxServiceError("invalid_argument", "timeoutSeconds must be an integer from 1 to 300");
    }
    const sandbox = this.requireManagedSandbox(id);
    if (sandbox.state !== "ready") throw new SandboxServiceError("conflict", "Sandbox is not ready");
    if (sandbox.lease_expires_at <= this.now()) throw new SandboxServiceError("conflict", "Sandbox lease has expired");
    if (this.activeSandboxes.has(id)) throw new SandboxServiceError("conflict", "Sandbox has an active job");
    const jobId = randomUUID();
    this.insertJob(jobId, id, "exec", this.now());
    this.launch(id, jobId, async () => {
      const vm = await this.getVmOrNull(sandbox.vm_id!);
      if (!vm) throw new SandboxServiceError("not_found", "Managed VM no longer exists");
      if (vm.capabilities?.guestExec !== true && vm.capabilities?.guestExecution !== true) {
        throw new SandboxServiceError("unsupported", "Guest execution is unavailable for this VM");
      }
      return this.port.execInGuest(sandbox.vm_id!, input.argv, input.timeoutSeconds === undefined ? undefined : { timeoutMs: input.timeoutSeconds * 1000 });
    });
    return { jobId };
  }

  destroySandbox(id: string): { jobId: string } {
    this.assertStarted();
    const sandbox = this.requireManagedSandbox(id);
    if (sandbox.state === "destroyed") throw new SandboxServiceError("conflict", "Sandbox is already destroyed");
    if (this.activeSandboxes.has(id)) throw new SandboxServiceError("conflict", "Sandbox has an active job");
    return { jobId: this.queueDestroy(sandbox) };
  }

  /** Mark interrupted jobs failed, then retry managed cleanup and expired leases. */
  async reconcile(restart = false): Promise<void> {
    this.assertStarted();
    if (restart) {
      const at = this.now();
      const error = JSON.stringify({ code: "interrupted", message: "Job interrupted by service restart" });
      this.db.prepare("UPDATE jobs SET state='failed',error_json=?,updated_at=? WHERE state IN ('queued','running')").run(error, at);
      this.db.prepare("UPDATE sandboxes SET state='failed',error='Creation interrupted before clone was recorded' WHERE state='creating' AND vm_id IS NULL").run();
    }
    const candidates = this.db.prepare(`SELECT * FROM sandboxes WHERE
      (state IN ('creating','cleanup_failed','destroying') AND managed=1 AND vm_id IS NOT NULL)
      OR (state='ready' AND lease_expires_at<=?)`).all(this.now()) as SandboxRow[];
    for (const row of candidates) {
      if (!this.activeSandboxes.has(row.id)) this.queueDestroy(row);
    }
  }

  private async runCreate(id: string): Promise<{ sandboxId: string; vmId: string }> {
    const sandbox = this.requireRow(id);
    let cloneId: string | null = null;
    try {
      const existingIds = new Set((await this.port.listVms()).map(vm => vm.id.toLowerCase()));
      const clone = await this.port.cloneVm(sandbox.template_id, `sandbox-${id}`);
      if (!clone?.id || existingIds.has(clone.id.toLowerCase())) {
        throw new SandboxServiceError("utm_failure", "UTM did not return a new clone ID");
      }
      cloneId = clone.id;
      // This write is the ownership boundary. Cleanup never deletes a VM absent here.
      this.db.prepare("UPDATE sandboxes SET vm_id=?,managed=1 WHERE id=?").run(cloneId, id);
      await this.port.configureVm(cloneId, { network: sandbox.network });
      await this.port.startVm(cloneId);
      this.db.prepare("UPDATE sandboxes SET state='ready',error=NULL WHERE id=?").run(id);
      return { sandboxId: id, vmId: cloneId };
    } catch (error) {
      const message = this.describe(error);
      const recorded = this.findSandbox(id);
      if (cloneId && recorded?.managed === 1 && recorded.vm_id === cloneId) {
        try {
          await this.cleanupRecordedClone(recorded);
          this.db.prepare("UPDATE sandboxes SET state='failed',vm_id=NULL,managed=0,error=? WHERE id=?").run(message, id);
        } catch (cleanupError) {
          this.db.prepare("UPDATE sandboxes SET state='cleanup_failed',error=? WHERE id=?")
            .run(`${message}; cleanup: ${this.describe(cleanupError)}`, id);
        }
      } else {
        this.db.prepare("UPDATE sandboxes SET state='failed',error=? WHERE id=?").run(message, id);
      }
      throw error;
    }
  }

  private queueDestroy(sandbox: SandboxRow): string {
    if (!sandbox.vm_id || sandbox.managed !== 1) throw new SandboxServiceError("not_managed", "VM is not a recorded managed clone");
    const id = randomUUID();
    this.transaction(() => {
      this.db.prepare("UPDATE sandboxes SET state='destroying' WHERE id=?").run(sandbox.id);
      this.insertJob(id, sandbox.id, "destroy", this.now());
    });
    this.launch(sandbox.id, id, async () => {
      await this.cleanupRecordedClone(this.requireManagedSandbox(sandbox.id));
      this.db.prepare("UPDATE sandboxes SET state='destroyed',error=NULL WHERE id=?").run(sandbox.id);
      return { sandboxId: sandbox.id };
    });
    return id;
  }

  private async cleanupRecordedClone(sandbox: SandboxRow): Promise<void> {
    if (!sandbox.vm_id || sandbox.managed !== 1) throw new SandboxServiceError("not_managed", "VM is not a recorded managed clone");
    const vm = await this.getVmOrNull(sandbox.vm_id);
    if (!vm) return; // A prior delete may have completed before the process stopped.
    if (vm.id.toLowerCase() !== sandbox.vm_id.toLowerCase()) throw new SandboxServiceError("utm_failure", "UTM returned a mismatched VM ID");
    if (vm.status !== "stopped") await this.port.stopVm(sandbox.vm_id);
    await this.port.deleteVm(sandbox.vm_id);
  }

  private launch(sandboxId: string, jobId: string, work: () => Promise<unknown>): void {
    this.activeSandboxes.add(sandboxId);
    const task = Promise.resolve().then(async () => {
      this.db.prepare("UPDATE jobs SET state='running',updated_at=? WHERE id=?").run(this.now(), jobId);
      try {
        const result = await work();
        this.db.prepare("UPDATE jobs SET state='succeeded',result_json=?,updated_at=? WHERE id=?")
          .run(JSON.stringify(result), this.now(), jobId);
      } catch (error) {
        const structured = this.toError(error);
        this.db.prepare("UPDATE jobs SET state='failed',error_json=?,updated_at=? WHERE id=?")
          .run(JSON.stringify(structured), this.now(), jobId);
      }
    }).finally(() => {
      this.activeSandboxes.delete(sandboxId);
      this.pending.delete(task);
    });
    this.pending.add(task);
  }

  private async getVmOrNull(id: string): Promise<UtmVm | null> {
    try { return await this.port.getVm(id); }
    catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "not_found") return null;
      throw error;
    }
  }

  private toError(error: unknown): { code: ErrorCode; message: string } {
    if (error instanceof SandboxServiceError) return { code: error.code, message: error.message };
    if (error && typeof error === "object" && "code" in error) {
      if (error.code === "unsupported" || error.code === "not_found" || error.code === "conflict") {
        return { code: error.code, message: this.describe(error) };
      }
      if (error.code === "invalid_input") return { code: "invalid_argument", message: this.describe(error) };
    }
    return { code: "utm_failure", message: this.describe(error) };
  }

  private describe(error: unknown): string { return error instanceof Error ? error.message : String(error); }
  private insertJob(id: string, sandboxId: string, kind: JobKind, at: number): void {
    this.db.prepare("INSERT INTO jobs(id,sandbox_id,kind,state,created_at,updated_at) VALUES(?,?,?,'queued',?,?)")
      .run(id, sandboxId, kind, at, at);
  }
  private transaction(fn: () => void): void {
    this.db.exec("BEGIN IMMEDIATE");
    try { fn(); this.db.exec("COMMIT"); } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  private findSandbox(id: string): SandboxRow | undefined {
    return this.db.prepare("SELECT * FROM sandboxes WHERE id=?").get(id) as SandboxRow | undefined;
  }
  private requireRow(id: string): SandboxRow {
    const row = this.findSandbox(id);
    if (!row) throw new SandboxServiceError("not_found", "Sandbox does not exist");
    return row;
  }
  private requireManagedSandbox(id: string): SandboxRow {
    const row = this.findSandbox(id);
    if (!row || !row.vm_id || row.managed !== 1) throw new SandboxServiceError("not_managed", "VM is not a recorded managed clone");
    return row;
  }
  private toSandbox(row: SandboxRow): Sandbox {
    return {
      id: row.id, templateId: row.template_id, vmId: row.vm_id, network: row.network,
      state: row.state, createdAt: new Date(row.created_at).toISOString(),
      leaseExpiresAt: new Date(row.lease_expires_at).toISOString(), error: row.error
    };
  }
  private requireId(id: string): void {
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
      throw new SandboxServiceError("invalid_argument", "Invalid VM ID");
    }
  }
  private assertOpen(): void { if (this.closed) throw new SandboxServiceError("conflict", "Service is closed"); }
  private assertStarted(): void {
    this.assertOpen();
    if (!this.started) throw new SandboxServiceError("conflict", "Call start() before using the service");
  }
}
