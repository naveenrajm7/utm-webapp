import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import supertest from "supertest";
import type { Vm as AdapterVm } from "@repo/utm-adapter";
import { createServer } from "../server";
import { LocalUtmPort } from "../v1/localUtmPort";
import { VmPowerJobs } from "../v1/vmPowerJobs";

const KEY = "local-vm-test-key";
const ID = "12345678-1234-1234-1234-123456789abc";
const temporaryDirectories: string[] = [];
const journalPath = () => {
  const directory = mkdtempSync(join(tmpdir(), "utm-api-power-test-"));
  temporaryDirectories.push(directory);
  return join(directory, "jobs.json");
};

const makeVm = (status: "stopped" | "started"): AdapterVm => ({
  id: ID,
  name: "Vagrant test",
  status,
  backend: "qemu",
  network: "shared",
  networkInterfaces: [{ mode: "shared" }],
  icon: "debian",
  memoryMiB: 4096,
  cpuCores: 2,
  architecture: "aarch64",
  machine: "virt",
  serialPorts: [{ interface: "ptty" }],
  drives: [],
  capabilities: {
    clone: false,
    configure: false,
    start: status === "stopped",
    stop: status === "started",
    delete: false,
    guestExec: false,
    guestAgent: "unknown",
    networkPresets: [],
    serial: true,
    display: true,
  },
});

const makePorts = () => {
  let status: "stopped" | "started" = "stopped";
  const adapter = {
    getCapabilities: async () => ({
      utmVersion: "5.0.6", utmctlAvailable: true, jxaAvailable: true,
      clone: false, configure: false, delete: false, guestExec: false,
    }),
    listVms: async () => [makeVm(status)],
    getVm: async (id: string) => {
      if (id !== ID) throw Object.assign(new Error("VM not found"), { code: "not_found" });
      return makeVm(status);
    },
    startVm: async () => { status = "started"; },
    stopVm: async () => { status = "stopped"; },
  };
  const utm = new LocalUtmPort(adapter);
  const path = journalPath();
  const power = new VmPowerJobs(adapter, path);
  return { utm, power, adapter, path };
};

const completed = async (power: VmPowerJobs, id: string) => {
  for (let i = 0; i < 20; i++) {
    const job = power.getJob(id);
    if (job?.state === "succeeded" || job?.state === "failed") return job;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error("power job did not finish");
};

describe("local UTM web backend", () => {
  beforeEach(() => { process.env.UTM_API_KEY = KEY; });
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0))
      rmSync(directory, { recursive: true, force: true });
  });

  it("serves actual adapter fields and completes browser power jobs without the sandbox service", async () => {
    const ports = makePorts();
    const request = supertest(createServer(ports));
    const auth = { "x-api-key": KEY };

    expect((await request.get("/v1/vms").set(auth).expect(200)).body[0])
      .toMatchObject({ id: ID, name: "Vagrant test", status: "stopped", icon: "debian", networkInterfaces: [{ mode: "shared" }], capabilities: { start: true, stop: false, serial: true, display: true } });
    expect((await request.get("/list_vms").set(auth).expect(200)).body[0])
      .toEqual({ UUID: ID, Name: "Vagrant test", Status: "stopped" });
    expect((await request.get("/v1/capabilities").set(auth).expect(200)).body)
      .toMatchObject({ utmVersion: "5.0.6", features: { utmctl: true } });
    expect((await request.get(`/v1/vms/${ID}`).set(auth).expect(200)).body)
      .toMatchObject({ architecture: "aarch64", capabilities: { serial: true, display: true } });
    expect((await request.get("/vm_info").query({ uuid: ID }).set(auth).expect(200)).body)
      .toMatchObject({ UUID: ID, Name: "Vagrant test", Status: "stopped", Architecture: "aarch64", Memory: 4096 });
    expect((await request.get("/status_vm").query({ uuid: ID }).set(auth).expect(200)).body)
      .toEqual({ status: "success", vmStatus: "stopped" });

    const started = await request.post("/start").query({ uuid: ID }).set(auth).expect(202);
    expect(started.body).toMatchObject({ status: "success", jobId: expect.any(String) });
    expect((await completed(ports.power, started.body.jobId)).state).toBe("succeeded");
    expect((await request.get(`/v1/jobs/${started.body.jobId}`).set(auth).expect(200)).body.state).toBe("succeeded");
    expect((await request.get("/v1/vms").set(auth).expect(200)).body[0])
      .toMatchObject({ status: "started", capabilities: { start: false, stop: true } });
    expect((await request.get("/list_vms").set(auth).expect(200)).body[0].Status).toBe("started");
    expect((await request.get("/status_vm").query({ uuid: ID }).set(auth).expect(200)).body.vmStatus).toBe("started");
    await request.post(`/v1/vms/${ID}/start`).set(auth).expect(409);
    await request.post("/start").query({ uuid: ID }).set(auth).expect(409);

    const stopped = await request.post(`/v1/vms/${ID}/stop`).set(auth).expect(202);
    expect((await completed(ports.power, stopped.body.jobId)).state).toBe("succeeded");
    expect((await request.get("/list_vms").set(auth).expect(200)).body[0].Status).toBe("stopped");
    await request.post("/stop").query({ uuid: ID }).set(auth).expect(409);
    await request.get("/v1/jobs/missing").set(auth).expect(404);
    await request.get("/v1/templates").set(auth).expect(503);
  });

  it("rejects a second power request while the first is being checked", async () => {
    let release = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    const power = new VmPowerJobs({
      getVm: async () => { await gate; return makeVm("stopped"); },
      startVm: async () => {},
      stopVm: async () => {},
    }, journalPath());
    const first = power.startVm(ID);
    await expect(power.startVm(ID)).rejects.toMatchObject({ code: "conflict" });
    release();
    const ref = await first;
    expect((await completed(power, ref.jobId)).state).toBe("succeeded");
  });

  it("rejects conflicting legacy and v1 power requests through the shared job service", async () => {
    const ports = makePorts();
    let release = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    ports.adapter.startVm = async () => { await gate; };
    const request = supertest(createServer(ports));
    const auth = { "x-api-key": KEY };
    const first = await request.post("/start").query({ uuid: ID }).set(auth).expect(202);
    await request.post(`/v1/vms/${ID}/stop`).set(auth).expect(409);
    await request.post("/start").query({ uuid: ID }).set(auth).expect(409);
    release();
    expect((await completed(ports.power, first.body.jobId)).state).toBe("succeeded");
  });

  it("restores a completed job after API restart while actual VM state remains available", async () => {
    const ports = makePorts();
    const auth = { "x-api-key": KEY };
    const first = supertest(createServer(ports));
    const started = await first.post(`/v1/vms/${ID}/start`).set(auth).expect(202);
    expect((await completed(ports.power, started.body.jobId)).state).toBe("succeeded");

    const restarted = supertest(createServer({ utm: ports.utm,
      power: new VmPowerJobs(ports.adapter, ports.path) }));
    expect((await restarted.get(`/v1/jobs/${started.body.jobId}`).set(auth).expect(200)).body)
      .toMatchObject({ state: "succeeded", result: { vmId: ID, status: "started" } });
    expect((await restarted.get(`/v1/vms/${ID}`).set(auth).expect(200)).body.status)
      .toBe("started");
    expect((await restarted.get("/status_vm").query({ uuid: ID }).set(auth).expect(200)).body.vmStatus)
      .toBe("started");
  });
});
