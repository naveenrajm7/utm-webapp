import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import supertest from "supertest";
import type { HostCapabilities, Vm } from "@repo/utm-adapter";
import { createServer } from "../server";
import { LocalUtmPort } from "../v1/localUtmPort";
import { VmPowerJobs } from "../v1/vmPowerJobs";
import { JobJournal, JournalError } from "../v1/jobJournal";

const KEY = "direct-vm-key";
const ID = "12345678-1234-1234-1234-123456789abc";
const OTHER = "12345678-1234-1234-1234-123456789abd";
const COPY = "12345678-1234-1234-1234-123456789abe";
const auth = { "x-api-key": KEY };
const typed = (code: string) => Object.assign(new Error(code), { code });

const vm = (id: string, name: string): Vm => ({
  id, name, status: "stopped", backend: "qemu", network: "shared",
  memoryMiB: 4096, cpuCores: 2,
  capabilities: {
    clone: true, configure: true, delete: true, start: true, stop: false,
    guestExec: false, guestAgent: "unknown", networkPresets: [],
    serial: false, display: false,
  },
});

const temporaryDirectories: string[] = [];
const journalPath = () => {
  const directory = mkdtempSync(join(tmpdir(), "utm-api-jobs-test-"));
  temporaryDirectories.push(directory);
  return join(directory, "jobs.json");
};

const fixture = (path = journalPath()) => {
  const vms = new Map([[ID, vm(ID, "Source")], [OTHER, vm(OTHER, "Other")]]);
  const host: HostCapabilities & { delete?: boolean } = {
    utmVersion: "5.0.6", utmctlAvailable: true, jxaAvailable: true,
    clone: true, configure: true, delete: true, guestExec: false,
  };
  const calls: string[] = [];
  const hooks: {
    clone?: () => Promise<void>;
    configure?: () => Promise<void>;
    delete?: () => Promise<void>;
  } = {};
  const adapter = {
    getCapabilities: async () => host,
    listVms: async () => [...vms.values()],
    getVm: async (id: string) => {
      const value = vms.get(id);
      if (!value) throw typed("not_found");
      return value;
    },
    cloneVm: async (id: string, name: string) => {
      calls.push("clone");
      if (hooks.clone) await hooks.clone();
      const copy = { ...vms.get(id)!, id: COPY, name };
      vms.set(COPY, copy);
      return copy;
    },
    configureVm: async (id: string, patch: { name?: string; memoryMiB?: number; cpuCores?: number }) => {
      calls.push("configure");
      if (hooks.configure) await hooks.configure();
      vms.set(id, { ...vms.get(id)!, ...patch });
      return vms.get(id)!;
    },
    deleteVm: async (id: string) => {
      calls.push("delete");
      if (hooks.delete) await hooks.delete();
      vms.delete(id);
    },
    startVm: async (id: string) => {
      calls.push("start");
      vms.set(id, { ...vms.get(id)!, status: "started",
        capabilities: { ...vms.get(id)!.capabilities, start: false, stop: true } });
    },
    stopVm: async (id: string) => {
      calls.push("stop");
      vms.set(id, { ...vms.get(id)!, status: "stopped",
        capabilities: { ...vms.get(id)!.capabilities, start: true, stop: false } });
    },
  };
  const jobs = new VmPowerJobs(adapter, path);
  const utm = new LocalUtmPort(adapter);
  const request = supertest(createServer({ utm, power: jobs, management: jobs }));
  return { vms, host, calls, hooks, adapter, jobs, utm, request, path };
};

const completed = async (jobs: VmPowerJobs, id: string) => {
  for (let i = 0; i < 50; i++) {
    const job = jobs.getJob(id);
    if (job?.state === "succeeded" || job?.state === "failed") return job;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error("job did not finish");
};

describe("direct VM API", () => {
  beforeEach(() => { process.env.UTM_API_KEY = KEY; });
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0))
      rmSync(directory, { recursive: true, force: true });
  });

  it("validates exact JSON shapes and authenticates before admitting a job", async () => {
    const f = fixture();
    await f.request.post("/v1/vms/" + ID + "/clone").send({ name: "Copy" }).expect(401);
    await f.request.patch("/v1/vms/" + ID).send({ name: "New" }).expect(401);
    await f.request.delete("/v1/vms/" + ID).send({ confirmName: "Source" }).expect(401);
    const invalid = [
      () => f.request.post("/v1/vms/" + ID + "/clone").send({ name: "" }),
      () => f.request.post("/v1/vms/" + ID + "/clone").send({ name: "bad\nname" }),
      () => f.request.post("/v1/vms/" + ID + "/clone").send({ name: "bad\u0085name" }),
      () => f.request.post("/v1/vms/" + ID + "/clone").send({ name: "Copy", network: "shared" }),
      () => f.request.patch("/v1/vms/" + ID).send({}),
      () => f.request.patch("/v1/vms/" + ID).send({ network: "offline" }),
      () => f.request.patch("/v1/vms/" + ID).send({ memoryMiB: null }),
      () => f.request.patch("/v1/vms/" + ID).send({ memoryMiB: 127 }),
      () => f.request.patch("/v1/vms/" + ID).send({ cpuCores: 1.5 }),
      () => f.request.patch("/v1/vms/" + ID).send({ name: null }),
      () => f.request.delete("/v1/vms/" + ID).send({ confirmName: null }),
      () => f.request.delete("/v1/vms/" + ID).send({ confirmName: "Source", force: true }),
    ];
    for (const pending of invalid) {
      const response = await pending().set(auth).expect(400);
      expect(response.body.error.code).toBe("invalid_input");
    }
    expect(f.calls).toEqual([]);
  });

  it("returns reconciled clone, edit, and delete job results", async () => {
    const f = fixture();
    const capabilities = await f.request.get("/v1/capabilities").set(auth).expect(200);
    expect(capabilities.body.features.delete).toBe(true);
    expect((await f.request.get("/v1/vms").set(auth).expect(200)).body[0].capabilities)
      .toMatchObject({ guestExec: false, networkPresets: [] });
    expect((await f.request.get("/v1/vms/" + ID).set(auth).expect(200)).body.capabilities)
      .toMatchObject({ guestExec: false, networkPresets: [] });
    const clone = await f.request.post("/v1/vms/" + ID + "/clone").set(auth).send({ name: " Copy " }).expect(202);
    expect((await completed(f.jobs, clone.body.jobId)).result).toEqual({ vmId: COPY });
    expect((await f.request.get("/v1/jobs/" + clone.body.jobId).set(auth).expect(200)).body)
      .toMatchObject({ state: "succeeded", result: { vmId: COPY } });
    const edit = await f.request.patch("/v1/vms/" + COPY).set(auth)
      .send({ name: "Edited", memoryMiB: 8192, cpuCores: 0 }).expect(202);
    expect((await completed(f.jobs, edit.body.jobId)).result)
      .toEqual({ vmId: COPY, status: "stopped" });
    expect(f.vms.get(COPY)).toMatchObject({ name: "Edited", memoryMiB: 8192, cpuCores: 0 });
    await f.request.delete("/v1/vms/" + COPY).set(auth)
      .send({ confirmName: "edited" }).expect(409);
    const deletion = await f.request.delete("/v1/vms/" + COPY).set(auth)
      .send({ confirmName: "Edited" }).expect(202);
    expect((await completed(f.jobs, deletion.body.jobId)).result)
      .toEqual({ vmId: COPY, deleted: true });
    expect(f.vms.has(COPY)).toBe(false);
  });

  it("keeps unsupported host or VM capabilities disabled and checks state first", async () => {
    const f = fixture();
    delete (f.host as Partial<HostCapabilities>).delete;
    expect((await f.request.get("/v1/capabilities").set(auth).expect(200)).body.features.delete).toBe(false);
    expect((await f.request.get("/v1/vms").set(auth).expect(200)).body[0].capabilities.delete).toBe(false);
    expect((await f.request.get("/v1/vms/" + ID).set(auth).expect(200)).body.capabilities.delete).toBe(false);
    expect((await f.request.delete("/v1/vms/" + ID).set(auth)
      .send({ confirmName: "Source" }).expect(422)).body.error.code).toBe("unsupported");
    f.host.clone = false;
    await f.request.post("/v1/vms/" + ID + "/clone").set(auth).send({ name: "Copy" }).expect(422);
    f.host.configure = false;
    await f.request.patch("/v1/vms/" + ID).set(auth).send({ name: "New" }).expect(422);
    f.vms.get(ID)!.status = "started";
    await f.request.patch("/v1/vms/" + ID).set(auth).send({ name: "New" }).expect(409);
    f.vms.get(ID)!.status = "stopped";
    f.host.configure = true;
    f.vms.get(ID)!.capabilities.configure = false;
    await f.request.patch("/v1/vms/" + ID).set(auth).send({ name: "New" }).expect(422);
    expect(f.calls).toEqual([]);
  });

  it("returns typed admission errors for existing names, missing VMs, and unavailable UTM", async () => {
    const f = fixture();
    expect((await f.request.post("/v1/vms/" + ID + "/clone").set(auth)
      .send({ name: "Other" }).expect(409)).body.error.code).toBe("conflict");
    expect((await f.request.patch("/v1/vms/" + COPY).set(auth)
      .send({ name: "New" }).expect(404)).body.error.code).toBe("not_found");
    f.adapter.getCapabilities = async () => { throw typed("unavailable"); };
    expect((await f.request.patch("/v1/vms/" + ID).set(auth)
      .send({ name: "New" }).expect(503)).body.error.code).toBe("unavailable");
    expect(f.calls).toEqual([]);
  });

  it("shares the VM lock with legacy power and reserves clone names across source VMs", async () => {
    const f = fixture();
    let release = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    f.hooks.clone = async () => { await gate; };
    const clone = await f.request.post("/v1/vms/" + ID + "/clone").set(auth)
      .send({ name: "Reserved" }).expect(202);
    await f.request.post("/start").query({ uuid: ID.toUpperCase() }).set(auth).expect(409);
    await f.request.post("/v1/vms/" + ID.toUpperCase() + "/start").set(auth).expect(409);
    await f.request.patch("/v1/vms/" + ID).set(auth).send({ name: "New" }).expect(409);
    await f.request.delete("/v1/vms/" + ID).set(auth).send({ confirmName: "Source" }).expect(409);
    await f.request.post("/v1/vms/" + OTHER + "/clone").set(auth)
      .send({ name: "Reserved" }).expect(409);
    await f.request.patch("/v1/vms/" + OTHER).set(auth)
      .send({ name: "Reserved" }).expect(409);
    release();
    expect((await completed(f.jobs, clone.body.jobId)).state).toBe("succeeded");
    await f.request.post("/v1/vms/" + OTHER + "/clone").set(auth)
      .send({ name: "Reserved" }).expect(409);

    let releasePower = () => {};
    const powerGate = new Promise<void>(resolve => { releasePower = resolve; });
    f.adapter.startVm = async () => { await powerGate; };
    const power = await f.request.post("/start").query({ uuid: OTHER }).set(auth).expect(202);
    await f.request.post("/v1/vms/" + OTHER + "/clone").set(auth).send({ name: "Free" }).expect(409);
    releasePower();
    expect((await completed(f.jobs, power.body.jobId)).state).toBe("succeeded");
  });

  it("reserves rename targets against concurrent clones and renames", async () => {
    const f = fixture();
    let release = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    f.hooks.configure = async () => { await gate; };
    const rename = await f.request.patch("/v1/vms/" + ID).set(auth)
      .send({ name: "Shared" }).expect(202);
    await f.request.post("/v1/vms/" + OTHER + "/clone").set(auth)
      .send({ name: "shared" }).expect(409);
    await f.request.patch("/v1/vms/" + OTHER).set(auth)
      .send({ name: "Shared" }).expect(409);
    release();
    expect((await completed(f.jobs, rename.body.jobId)).state).toBe("succeeded");
    await f.request.post("/v1/vms/" + OTHER + "/clone").set(auth)
      .send({ name: "Shared" }).expect(409);
  });

  it("shares a case-insensitive UUID lock when legacy power is admitted first", async () => {
    const f = fixture();
    f.adapter.getVm = async id => {
      const value = f.vms.get(id.toLowerCase());
      if (!value) throw typed("not_found");
      return value;
    };
    let release = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    f.adapter.startVm = async () => { f.calls.push("start"); await gate; };
    const first = await f.request.post("/start").query({ uuid: ID.toUpperCase() })
      .set(auth).expect(202);
    await f.request.patch("/v1/vms/" + ID).set(auth).send({ name: "New" }).expect(409);
    await f.request.post("/v1/vms/" + ID + "/start").set(auth).expect(409);
    release();
    expect((await completed(f.jobs, first.body.jobId)).state).toBe("succeeded");
    expect(f.calls).toEqual(["start"]);
  });

  it("rejects admission before UTM mutation when the journal cannot be written", async () => {
    const f = fixture();
    mkdirSync(f.path);
    const response = await f.request.post("/v1/vms/" + ID + "/clone").set(auth)
      .send({ name: "Copy" }).expect(503);
    expect(response.body.error.code).toBe("service_unavailable");
    await f.request.post("/start").query({ uuid: ID }).set(auth).expect(503);
    expect(f.calls).toEqual([]);
  });

  it("skips the UTM command if persisting running state fails", async () => {
    const f = fixture();
    const update = jest.spyOn(JobJournal.prototype, "update")
      .mockImplementationOnce(() => { throw new JournalError("disk unavailable"); });
    try {
      const response = await f.request.post("/v1/vms/" + ID + "/start")
        .set(auth).expect(202);
      expect(await completed(f.jobs, response.body.jobId))
        .toMatchObject({ state: "failed", error: { code: "service_unavailable" } });
      expect(f.calls).toEqual([]);
    } finally {
      update.mockRestore();
    }
  });

  it("rechecks stopped state and current delete name before mutation", async () => {
    const f = fixture();
    let reads = 0;
    const original = f.adapter.getVm;
    f.adapter.getVm = async id => {
      const current = await original(id);
      reads++;
      if (reads === 2) current.status = "started";
      return current;
    };
    const edit = await f.request.patch("/v1/vms/" + ID).set(auth).send({ name: "New" }).expect(202);
    expect((await completed(f.jobs, edit.body.jobId)).error?.code).toBe("conflict");
    expect(f.calls).toEqual([]);
    f.vms.get(ID)!.status = "stopped";
    reads = 0;
    f.adapter.getVm = async id => {
      const current = await original(id);
      reads++;
      if (reads === 2) current.name = "Renamed elsewhere";
      return current;
    };
    const deletion = await f.request.delete("/v1/vms/" + ID).set(auth)
      .send({ confirmName: "Source" }).expect(202);
    expect((await completed(f.jobs, deletion.body.jobId)).error?.code).toBe("conflict");
    expect(f.calls).toEqual([]);
  });

  it("reconciles ambiguous mutations and reports failures without retrying", async () => {
    const f = fixture();
    f.hooks.clone = async () => {
      f.vms.set(COPY, vm(COPY, "Copy"));
      throw typed("timeout");
    };
    const clone = await f.request.post("/v1/vms/" + ID + "/clone").set(auth)
      .send({ name: "Copy" }).expect(202);
    expect((await completed(f.jobs, clone.body.jobId)).result).toEqual({ vmId: COPY });
    f.hooks.configure = async () => { throw typed("timeout"); };
    const edit = await f.request.patch("/v1/vms/" + ID).set(auth)
      .send({ memoryMiB: 8192 }).expect(202);
    const failed = await completed(f.jobs, edit.body.jobId);
    expect(failed).toMatchObject({ state: "failed", error: { code: "timeout" } });
    expect(failed.error?.message).toContain("refresh inventory before retrying");
    f.hooks.configure = async () => {
      f.vms.get(ID)!.memoryMiB = 8192;
      throw typed("timeout");
    };
    const reconciled = await f.request.patch("/v1/vms/" + ID).set(auth)
      .send({ memoryMiB: 8192 }).expect(202);
    expect((await completed(f.jobs, reconciled.body.jobId)).state).toBe("succeeded");
    f.hooks.delete = async () => { throw typed("timeout"); };
    const deletion = await f.request.delete("/v1/vms/" + COPY).set(auth)
      .send({ confirmName: "Copy" }).expect(202);
    expect((await completed(f.jobs, deletion.body.jobId)).error?.code).toBe("timeout");
    f.hooks.delete = async () => { f.vms.delete(COPY); throw typed("timeout"); };
    const finalDelete = await f.request.delete("/v1/vms/" + COPY).set(auth)
      .send({ confirmName: "Copy" }).expect(202);
    expect((await completed(f.jobs, finalDelete.body.jobId)).result)
      .toEqual({ vmId: COPY, deleted: true });
    expect(f.calls.filter(call => call === "clone")).toHaveLength(1);
  });

  it("restores completed jobs after restart while inventory shows the actual state", async () => {
    const f = fixture();
    const edit = await f.request.patch("/v1/vms/" + ID).set(auth)
      .send({ name: "Changed" }).expect(202);
    expect((await completed(f.jobs, edit.body.jobId)).state).toBe("succeeded");
    f.jobs.close();
    const restarted = new VmPowerJobs(f.adapter, f.path);
    const request = supertest(createServer({ utm: f.utm, power: restarted, management: restarted }));
    expect((await request.get("/v1/jobs/" + edit.body.jobId).set(auth).expect(200)).body)
      .toEqual({ id: edit.body.jobId, state: "succeeded", result: { vmId: ID, status: "stopped" } });
    expect((await request.get("/v1/vms/" + ID).set(auth).expect(200)).body.name).toBe("Changed");
  });

  it("restores a completed typed failure after restart", async () => {
    const f = fixture();
    f.hooks.configure = async () => { throw typed("timeout"); };
    const edit = await f.request.patch("/v1/vms/" + ID).set(auth)
      .send({ memoryMiB: 8192 }).expect(202);
    const completedJob = await completed(f.jobs, edit.body.jobId);
    expect(completedJob?.state).toBe("failed");
    f.jobs.close();
    expect(new VmPowerJobs(f.adapter, f.path).getJob(edit.body.jobId)).toEqual(completedJob);
  });

  it("evicts the oldest terminal job when the bounded journal fills", () => {
    const path = journalPath();
    const ids = Array.from({ length: 256 }, () => randomUUID());
    writeFileSync(path, JSON.stringify({ version: 1, jobs: ids.map(id => ({
      id, state: "succeeded", result: { vmId: ID, status: "stopped" },
    })) }));
    const journal = new JobJournal(path);
    const admittedId = randomUUID();
    journal.insert({ id: admittedId, state: "queued" });
    expect(journal.get(ids[0]!)).toBeNull();
    expect(journal.get(ids[1]!)).not.toBeNull();
    expect(journal.get(admittedId)?.state).toBe("queued");
  });

  it("gives one process exclusive journal ownership and releases it cleanly", () => {
    const path = journalPath();
    const first = new JobJournal(path);
    expect(() => new JobJournal(path)).toThrow("already owned");
    const childCode = `const { JobJournal } = require(${JSON.stringify(join(__dirname, "../v1/jobJournal.ts"))});
      try { new JobJournal(process.env.JOURNAL_PATH).close(); process.exit(0); }
      catch { process.exit(2); }`;
    const runChild = () => spawnSync(process.execPath,
      ["-r", "esbuild-register", "-e", childCode],
      { env: { ...process.env, JOURNAL_PATH: path } });
    expect(runChild().status).toBe(2);
    first.close();
    expect(runChild().status).toBe(0);
    expect(new JobJournal(path).isOwned()).toBe(true);
  });

  it("recovers a stale journal lock after its process has exited", () => {
    const path = journalPath();
    const exited = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
    expect(exited.status).toBe(0);
    writeFileSync(`${path}.lock`, JSON.stringify({ pid: exited.pid, token: "stale" }));
    const journal = new JobJournal(path);
    expect(journal.isOwned()).toBe(true);
    journal.close();
  });

  it("recovers interrupted queued and running jobs as unknown without replay", async () => {
    const f = fixture();
    const queuedId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
    const queuedPath = journalPath();
    const queuedJournal = new JobJournal(queuedPath);
    queuedJournal.insert({ id: queuedId, state: "queued" });
    queuedJournal.close();
    expect(new VmPowerJobs(f.adapter, queuedPath).getJob(queuedId))
      .toMatchObject({ state: "unknown", error: { code: "outcome_unknown" } });
    let release = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    f.adapter.startVm = async () => { f.calls.push("start"); await gate; };
    const started = await f.request.post("/v1/vms/" + ID + "/start").set(auth).expect(202);
    for (let i = 0; i < 50 && f.calls.length === 0; i++)
      await new Promise(resolve => setTimeout(resolve, 5));
    expect(f.calls).toEqual(["start"]);
    f.jobs.close();
    const restarted = new VmPowerJobs(f.adapter, f.path);
    const request = supertest(createServer({ utm: f.utm, power: restarted, management: restarted }));
    expect((await request.get("/v1/jobs/" + started.body.jobId).set(auth).expect(200)).body)
      .toMatchObject({ id: started.body.jobId, state: "unknown",
        error: { code: "outcome_unknown" } });
    expect(f.calls).toEqual(["start"]);
    release();
    for (let i = 0; i < 50 && f.jobs.getJob(started.body.jobId)?.state !== "unknown"; i++)
      await new Promise(resolve => setTimeout(resolve, 5));
    expect(f.jobs.getJob(started.body.jobId)?.state).toBe("unknown");
    expect(restarted.getJob(started.body.jobId)?.state).toBe("unknown");
  });
});
