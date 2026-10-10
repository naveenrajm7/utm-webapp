import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import supertest from "supertest";
import { createServer } from "../server";
import type { ApiPorts, Job, Vm } from "../v1/ports";
import * as jxa from "../utils/runJxa";
import * as legacy from "../services/legacyVmService";

const KEY = "test-api-key";
const VM_ID = "12345678-1234-1234-1234-123456789abc";
const vm: Vm = {
  id: VM_ID,
  name: "Template",
  status: "stopped",
  backend: "qemu",
  capabilities: { guestExec: true },
};
const job: Job = {
  id: "job_1",
  state: "succeeded",
  result: { stdout: "ok", stderr: "", exitCode: 0 },
};

const makePorts = (): ApiPorts => ({
  utm: {
    getCapabilities: jest.fn(async () => ({
      utmVersion: "5.0.6",
      features: { clone: true },
    })),
    listVms: jest.fn(async () => [vm]),
    getVm: jest.fn(async () => vm),
  },
  sandbox: {
    startVm: jest.fn(async () => ({ jobId: "job_1" })),
    stopVm: jest.fn(async () => ({ jobId: "job_1" })),
    listTemplates: jest.fn(async () => [vm]),
    createSandbox: jest.fn(async () => ({
      sandboxId: "sandbox_1",
      jobId: "job_1",
    })),
    getSandbox: jest.fn(async () => ({
      id: "sandbox_1",
      vmId: VM_ID,
      status: "running",
      leaseExpiresAt: "2026-10-10T00:00:00Z",
    })),
    execSandbox: jest.fn(async () => ({ jobId: "job_1" })),
    destroySandbox: jest.fn(async () => ({ jobId: "job_1" })),
    getJob: jest.fn(async () => job),
  },
});

const authed = (ports: ApiPorts) => supertest(createServer(ports));

describe("/v1 API", () => {
  beforeEach(() => {
    process.env.UTM_API_KEY = KEY;
  });

  it("requires an API key and gives a structured error", async () => {
    const ports = makePorts();
    const response = await authed(ports).get("/v1/vms").expect(401);
    expect(response.body).toEqual({
      error: { code: "unauthorized", message: "Unauthorized" },
    });
    expect(ports.utm.listVms).not.toHaveBeenCalled();
  });

  it("routes inventory and capabilities to the UTM port", async () => {
    const request = authed(makePorts());
    expect(
      (await request.get("/v1/capabilities").set("x-api-key", KEY).expect(200))
        .body.features.clone,
    ).toBe(true);
    expect(
      (await request.get("/v1/vms").set("x-api-key", KEY).expect(200)).body,
    ).toEqual([vm]);
    expect(
      (await request.get(`/v1/vms/${VM_ID}`).set("x-api-key", KEY).expect(200))
        .body,
    ).toEqual(vm);
  });

  it("routes sandbox lifecycle and returns asynchronous job references", async () => {
    const ports = makePorts();
    const request = authed(ports);
    expect(
      (
        await request
          .post(`/v1/vms/${VM_ID}/start`)
          .set("x-api-key", KEY)
          .expect(202)
      ).body,
    ).toEqual({ jobId: "job_1" });
    expect(
      (
        await request
          .post(`/v1/vms/${VM_ID}/stop`)
          .set("x-api-key", KEY)
          .expect(202)
      ).body,
    ).toEqual({ jobId: "job_1" });
    expect(
      (await request.get("/v1/templates").set("x-api-key", KEY).expect(200))
        .body,
    ).toEqual([vm]);
    expect(
      (
        await request
          .post("/v1/sandboxes")
          .set("x-api-key", KEY)
          .send({ templateId: VM_ID, network: "offline", ttlSeconds: 3600 })
          .expect(202)
      ).body,
    ).toEqual({ sandboxId: "sandbox_1", jobId: "job_1" });
    expect(ports.sandbox.createSandbox).toHaveBeenCalledWith({
      templateId: VM_ID,
      network: "offline",
      ttlSeconds: 3600,
    });
    expect(
      (
        await request
          .get("/v1/sandboxes/sandbox_1")
          .set("x-api-key", KEY)
          .expect(200)
      ).body.id,
    ).toBe("sandbox_1");
    expect(
      (
        await request
          .post("/v1/sandboxes/sandbox_1/exec")
          .set("x-api-key", KEY)
          .send({ argv: ["/bin/echo", "hello"], timeoutSeconds: 5 })
          .expect(202)
      ).body,
    ).toEqual({ jobId: "job_1" });
    expect(ports.sandbox.execSandbox).toHaveBeenCalledWith("sandbox_1", {
      argv: ["/bin/echo", "hello"],
      timeoutSeconds: 5,
    });
    expect(
      (
        await request
          .delete("/v1/sandboxes/sandbox_1")
          .set("x-api-key", KEY)
          .expect(202)
      ).body,
    ).toEqual({ jobId: "job_1" });
    expect(
      (await request.get("/v1/jobs/job_1").set("x-api-key", KEY).expect(200))
        .body,
    ).toEqual(job);
  });

  it("rejects bad VM IDs and bodies before calling services", async () => {
    const ports = makePorts();
    const request = authed(ports);
    expect(
      (
        await request
          .get("/v1/vms/not-a-uuid")
          .set("x-api-key", KEY)
          .expect(400)
      ).body.error.code,
    ).toBe("invalid_input");
    expect(
      (
        await request
          .post("/v1/sandboxes")
          .set("x-api-key", KEY)
          .send({ templateId: VM_ID, network: "bridged", ttlSeconds: 30 })
          .expect(400)
      ).body.error.code,
    ).toBe("invalid_input");
    expect(
      (
        await request
          .post("/v1/sandboxes/sandbox_1/exec")
          .set("x-api-key", KEY)
          .send({ argv: "echo hi" })
          .expect(400)
      ).body.error.code,
    ).toBe("invalid_input");
    expect(ports.utm.getVm).not.toHaveBeenCalled();
    expect(ports.sandbox.createSandbox).not.toHaveBeenCalled();
    expect(ports.sandbox.execSandbox).not.toHaveBeenCalled();
  });

  it("maps typed service errors and masks unexpected errors", async () => {
    const ports = makePorts();
    ports.sandbox.execSandbox = jest.fn(async () => {
      throw { code: "unsupported", message: "Guest execution unavailable" };
    });
    ports.utm.getVm = jest.fn(async () => {
      throw new Error("private host detail");
    });
    const request = authed(ports);
    expect(
      (
        await request
          .post("/v1/sandboxes/sandbox_1/exec")
          .set("x-api-key", KEY)
          .send({ argv: ["true"] })
          .expect(422)
      ).body,
    ).toEqual({
      error: { code: "unsupported", message: "Guest execution unavailable" },
    });
    expect(
      (await request.get(`/v1/vms/${VM_ID}`).set("x-api-key", KEY).expect(500))
        .body,
    ).toEqual({
      error: { code: "internal", message: "Internal server error" },
    });
    expect(
      (await request.get("/v1/not-found").set("x-api-key", KEY).expect(404))
        .body.error.code,
    ).toBe("not_found");
  });

  it("returns structured errors for malformed JSON and unwired services", async () => {
    const request = supertest(createServer());
    expect(
      (await request.get("/v1/vms").set("x-api-key", KEY).expect(503)).body
        .error.code,
    ).toBe("service_unavailable");
    expect(
      (
        await request
          .get("/v1/vms/not-a-uuid")
          .set("x-api-key", KEY)
          .expect(400)
      ).body.error.code,
    ).toBe("invalid_input");
    expect(
      (
        await request
          .post("/v1/sandboxes")
          .set("x-api-key", KEY)
          .set("Content-Type", "application/json")
          .send('{"templateId":')
          .expect(400)
      ).body.error.code,
    ).toBe("invalid_input");
  });

  it("rejects malicious legacy VM IDs without running a UTM process", async () => {
    const run = jest.spyOn(jxa, "runJxa");
    try {
      const response = await supertest(createServer())
        .get("/vm_info")
        .query({ uuid: `${VM_ID};touch /tmp/should-not-exist` })
        .set("x-api-key", KEY)
        .expect(400);
      expect(response.body.status).toBe("error");
      expect(run).not.toHaveBeenCalled();
    } finally {
      run.mockRestore();
    }
  });

  it("preserves legacy inventory, detail, and power route responses", async () => {
    const list = jest
      .spyOn(legacy, "listLegacyVms")
      .mockResolvedValue([{ UUID: VM_ID, Name: "Template" }]);
    const info = jest
      .spyOn(legacy, "getLegacyVmInfo")
      .mockResolvedValue({ UUID: VM_ID, Name: "Template" });
    const control = jest
      .spyOn(legacy, "controlLegacyVm")
      .mockResolvedValue({ status: "success", vmStatus: "started" });
    try {
      const request = supertest(createServer());
      expect(
        (await request.get("/list_vms").set("x-api-key", KEY).expect(200))
          .body[0].UUID,
      ).toBe(VM_ID);
      expect(
        (
          await request
            .get("/vm_info")
            .query({ uuid: VM_ID })
            .set("x-api-key", KEY)
            .expect(200)
        ).body.UUID,
      ).toBe(VM_ID);
      expect(
        (
          await request
            .post("/start")
            .query({ uuid: VM_ID })
            .set("x-api-key", KEY)
            .expect(200)
        ).body.status,
      ).toBe("success");
      expect(
        (
          await request
            .post("/stop")
            .query({ uuid: VM_ID })
            .set("x-api-key", KEY)
            .expect(200)
        ).body.status,
      ).toBe("success");
      expect(
        (
          await request
            .get("/status_vm")
            .query({ uuid: VM_ID })
            .set("x-api-key", KEY)
            .expect(200)
        ).body.vmStatus,
      ).toBe("started");
      expect(control).toHaveBeenCalledWith("start", VM_ID);
      expect(control).toHaveBeenCalledWith("stop", VM_ID);
      expect(control).toHaveBeenCalledWith("status", VM_ID);
    } finally {
      list.mockRestore();
      info.mockRestore();
      control.mockRestore();
    }
  });
});
