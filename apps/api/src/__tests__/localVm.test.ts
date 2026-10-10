import { beforeEach, describe, expect, it } from "@jest/globals";
import supertest from "supertest";
import type { Vm as AdapterVm } from "@repo/utm-adapter";
import { createServer } from "../server";
import { LocalUtmPort } from "../v1/localUtmPort";
import { VmPowerJobs } from "../v1/vmPowerJobs";

const KEY = "local-vm-test-key";
const ID = "12345678-1234-1234-1234-123456789abc";

const makeVm = (status: "stopped" | "started"): AdapterVm => ({
  id: ID,
  name: "Vagrant test",
  status,
  backend: "qemu",
  network: "shared",
  memoryMiB: 4096,
  cpuCores: 2,
  capabilities: {
    clone: status === "stopped",
    configure: status === "stopped",
    start: status === "stopped",
    stop: status === "started",
    delete: status === "stopped",
    guestExec: status === "started",
    guestAgent: "unknown",
    networkPresets: ["offline", "shared"],
  },
});

const makePorts = () => {
  let status: "stopped" | "started" = "stopped";
  const adapter = {
    getCapabilities: async () => ({
      utmVersion: "5.0.6", utmctlAvailable: true, jxaAvailable: true,
      clone: true, configure: true, guestExec: true,
    }),
    listVms: async () => [makeVm(status)],
    getVm: async (id: string) => {
      if (id !== ID) throw Object.assign(new Error("VM not found"), { code: "not_found" });
      return makeVm(status);
    },
    startVm: async () => { status = "started"; },
    stopVm: async () => { status = "stopped"; },
  };
  const utm = new LocalUtmPort(
    adapter,
    async () => ({ UUID: ID, Architecture: "aarch64", SerialPorts: [{}], Drives: [] }),
    async () => ({ host: "127.0.0.1", port: 5901 }),
  );
  const power = new VmPowerJobs(adapter);
  return { utm, power };
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

  it("serves actual adapter fields and completes browser power jobs without the sandbox service", async () => {
    const ports = makePorts();
    const request = supertest(createServer(ports));
    const auth = { "x-api-key": KEY };

    expect((await request.get("/v1/vms").set(auth).expect(200)).body[0])
      .toMatchObject({ id: ID, name: "Vagrant test", status: "stopped", capabilities: { start: true, stop: false } });
    expect((await request.get("/v1/capabilities").set(auth).expect(200)).body)
      .toMatchObject({ utmVersion: "5.0.6", features: { utmctl: true } });
    expect((await request.get(`/v1/vms/${ID}`).set(auth).expect(200)).body)
      .toMatchObject({ architecture: "aarch64", capabilities: { serial: true, display: true } });

    const started = await request.post(`/v1/vms/${ID}/start`).set(auth).expect(202);
    expect((await completed(ports.power, started.body.jobId)).state).toBe("succeeded");
    expect((await request.get(`/v1/jobs/${started.body.jobId}`).set(auth).expect(200)).body.state).toBe("succeeded");
    expect((await request.get("/v1/vms").set(auth).expect(200)).body[0])
      .toMatchObject({ status: "started", capabilities: { start: false, stop: true } });
    await request.post(`/v1/vms/${ID}/start`).set(auth).expect(409);

    const stopped = await request.post(`/v1/vms/${ID}/stop`).set(auth).expect(202);
    expect((await completed(ports.power, stopped.body.jobId)).state).toBe("succeeded");
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
    });
    const first = power.startVm(ID);
    await expect(power.startVm(ID)).rejects.toMatchObject({ code: "conflict" });
    release();
    const ref = await first;
    expect((await completed(power, ref.jobId)).state).toBe("succeeded");
  });
});
