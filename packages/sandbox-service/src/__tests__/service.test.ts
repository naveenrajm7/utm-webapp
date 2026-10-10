import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "@jest/globals";
import {
  SandboxService, SandboxServiceError, type ExecResult, type NetworkPreset,
  type UtmPort, type UtmVm
} from "../index";

class FakeUtm implements UtmPort {
  vms = new Map<string, UtmVm>([["personal-vm", { id: "personal-vm", name: "My VM" }], ["template-vm", { id: "template-vm", name: "Disposable template" }]]);
  clones: string[] = [];
  deleted: string[] = [];
  calls: string[] = [];
  network = new Map<string, NetworkPreset>();
  failAt: "clone" | "network" | "start" | "delete" | null = null;
  guestExec = true;
  failDelete = false;
  cloneReturnsPersonal = false;

  async listVms(): Promise<UtmVm[]> { return [...this.vms.values()]; }
  async getVm(id: string): Promise<UtmVm> {
    const vm = this.vms.get(id);
    if (!vm) throw Object.assign(new Error("VM not found"), { code: "not_found" });
    return { ...vm, capabilities: { guestExec: this.guestExec } };
  }
  async cloneVm(templateId: string, name: string): Promise<UtmVm> {
    this.calls.push(`clone:${templateId}`);
    if (this.failAt === "clone") throw new Error("clone failed");
    if (this.cloneReturnsPersonal) return this.vms.get("personal-vm")!;
    const id = `clone-${this.clones.length + 1}`;
    this.clones.push(id);
    this.vms.set(id, { id, name, status: "stopped" });
    return this.vms.get(id)!;
  }
  async configureVm(id: string, configuration: { network?: NetworkPreset }): Promise<UtmVm> {
    const network = configuration.network!;
    this.calls.push(`network:${id}:${network}`);
    if (this.failAt === "network") throw new Error("network failed");
    this.network.set(id, network);
    return this.vms.get(id)!;
  }
  async startVm(id: string): Promise<void> {
    this.calls.push(`start:${id}`);
    if (this.failAt === "start") throw new Error("start failed");
    this.vms.set(id, { ...this.vms.get(id)!, status: "started" });
  }
  async stopVm(id: string): Promise<void> {
    this.calls.push(`stop:${id}`);
    this.vms.set(id, { ...this.vms.get(id)!, status: "stopped" });
  }
  async deleteVm(id: string): Promise<void> {
    this.calls.push(`delete:${id}`);
    if (this.failAt === "delete" || this.failDelete) throw new Error("delete failed");
    this.deleted.push(id);
    this.vms.delete(id);
  }
  async execInGuest(id: string, argv: string[], options?: { timeoutMs?: number }): Promise<ExecResult> {
    this.calls.push(`exec:${id}:${argv.join(" ")}:${options?.timeoutMs ?? ""}`);
    return { stdout: "hello\n", stderr: "", exitCode: 0 };
  }
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "sandbox-service-"));
  const port = new FakeUtm();
  let now = Date.parse("2026-10-10T12:00:00Z");
  const make = () => new SandboxService({ dbPath: join(dir, "state.sqlite"), port, now: () => now, sweepIntervalMs: 0 });
  return { dir, port, make, advance: (ms: number) => { now += ms; }, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

async function ready(service: SandboxService, network: NetworkPreset = "offline", ttlSeconds = 60) {
  await service.approveTemplate("template-vm");
  const created = await service.createSandbox({ templateId: "template-vm", network, ttlSeconds });
  await service.waitForIdle();
  expect(service.getJob(created.jobId)?.state).toBe("succeeded");
  return created;
}

describe("SandboxService", () => {
  it("creates an approved offline clone, executes, and destroys only that clone", async () => {
    const f = fixture();
    const service = f.make();
    try {
      await service.start();
      await expect(service.createSandbox({ templateId: "template-vm", network: "offline", ttlSeconds: 60 }))
        .rejects.toMatchObject({ code: "invalid_argument" });
      const { sandboxId, jobId } = await ready(service);
      expect(service.getJob(jobId)?.result).toEqual({ sandboxId, vmId: "clone-1" });
      expect(service.getSandbox(sandboxId)).toMatchObject({ state: "ready", vmId: "clone-1", network: "offline" });
      expect(f.port.calls.slice(0, 3)).toEqual(["clone:template-vm", "network:clone-1:offline", "start:clone-1"]);
      const { jobId: execId } = service.executeSandbox(sandboxId, { argv: ["echo", "hello"], timeoutSeconds: 5 });
      await service.waitForIdle();
      expect(service.getJob(execId)).toMatchObject({ state: "succeeded", result: { stdout: "hello\n", stderr: "", exitCode: 0 } });
      const { jobId: destroyId } = service.destroySandbox(sandboxId);
      await service.waitForIdle();
      expect(service.getJob(destroyId)?.state).toBe("succeeded");
      expect(service.getSandbox(sandboxId)?.state).toBe("destroyed");
      expect(f.port.deleted).toEqual(["clone-1"]);
      expect(f.port.vms.has("personal-vm")).toBe(true);
    } finally { await service.close(); f.cleanup(); }
  });

  it("uses shared networking and returns unsupported when guest execution is absent", async () => {
    const f = fixture();
    const service = f.make();
    try {
      await service.start();
      const { sandboxId } = await ready(service, "shared");
      expect(f.port.network.get("clone-1")).toBe("shared");
      f.port.guestExec = false;
      const { jobId } = service.executeSandbox(sandboxId, { argv: ["true"] });
      await service.waitForIdle();
      expect(service.getJob(jobId)).toMatchObject({ state: "failed", error: { code: "unsupported" } });
      expect(f.port.calls.some(call => call.startsWith("exec:"))).toBe(false);
    } finally { await service.close(); f.cleanup(); }
  });

  it("cleans a recorded clone after setup fails, and does not delete when clone itself fails", async () => {
    const f = fixture();
    const service = f.make();
    try {
      await service.start();
      await service.approveTemplate("template-vm");
      f.port.failAt = "network";
      const first = await service.createSandbox({ templateId: "template-vm", network: "offline", ttlSeconds: 60 });
      await service.waitForIdle();
      expect(service.getJob(first.jobId)).toMatchObject({ state: "failed", error: { code: "utm_failure" } });
      expect(service.getSandbox(first.sandboxId)).toMatchObject({ state: "failed", vmId: null });
      expect(f.port.deleted).toEqual(["clone-1"]);
      expect(f.port.calls).not.toContain("stop:clone-1");
      f.port.failAt = "clone";
      const second = await service.createSandbox({ templateId: "template-vm", network: "offline", ttlSeconds: 60 });
      await service.waitForIdle();
      expect(service.getSandbox(second.sandboxId)).toMatchObject({ state: "failed", vmId: null });
      expect(f.port.deleted).toEqual(["clone-1"]);
    } finally { await service.close(); f.cleanup(); }
  });

  it("destroys a managed clone when its lease expires", async () => {
    const f = fixture();
    const service = f.make();
    try {
      await service.start();
      const { sandboxId } = await ready(service, "shared", 1);
      f.advance(1001);
      await service.reconcile();
      await service.waitForIdle();
      expect(service.getSandbox(sandboxId)?.state).toBe("destroyed");
      expect(f.port.deleted).toEqual(["clone-1"]);
    } finally { await service.close(); f.cleanup(); }
  });

  it("marks interrupted jobs and resumes managed cleanup after restart", async () => {
    const f = fixture();
    const first = f.make();
    try {
      await first.start();
      const { sandboxId, jobId } = await ready(first);
      await first.close();
      const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: new (path: string) => {
        exec(sql: string): void; close(): void;
      } };
      const db = new DatabaseSync(join(f.dir, "state.sqlite"));
      db.exec(`UPDATE sandboxes SET state='creating' WHERE id='${sandboxId}'; UPDATE jobs SET state='running' WHERE id='${jobId}'`);
      db.close();
      const restarted = f.make();
      try {
        await restarted.start();
        await restarted.waitForIdle();
        expect(restarted.getJob(jobId)).toMatchObject({ state: "failed", error: { code: "interrupted" } });
        expect(restarted.getSandbox(sandboxId)?.state).toBe("destroyed");
        expect(f.port.deleted).toEqual(["clone-1"]);
      } finally { await restarted.close(); }
    } finally { await first.close(); f.cleanup(); }
  });


  it("does not adopt or delete a preexisting personal VM if clone returns its ID", async () => {
    const f = fixture();
    const service = f.make();
    try {
      await service.start();
      await service.approveTemplate("template-vm");
      f.port.cloneReturnsPersonal = true;
      const { sandboxId, jobId } = await service.createSandbox({ templateId: "template-vm", network: "offline", ttlSeconds: 60 });
      await service.waitForIdle();
      expect(service.getJob(jobId)?.state).toBe("failed");
      expect(service.getSandbox(sandboxId)).toMatchObject({ state: "failed", vmId: null });
      expect(f.port.deleted).toEqual([]);
      expect(f.port.vms.has("personal-vm")).toBe(true);
    } finally { await service.close(); f.cleanup(); }
  });

  it("retains ownership and retries cleanup when cleanup itself fails", async () => {
    const f = fixture();
    const first = f.make();
    try {
      await first.start();
      await first.approveTemplate("template-vm");
      f.port.failAt = "network";
      f.port.failDelete = true;
      const { sandboxId } = await first.createSandbox({ templateId: "template-vm", network: "offline", ttlSeconds: 60 });
      await first.waitForIdle();
      expect(first.getSandbox(sandboxId)).toMatchObject({ state: "cleanup_failed", vmId: "clone-1" });
      await first.close();
      f.port.failAt = null;
      f.port.failDelete = false;
      const restarted = f.make();
      try {
        await restarted.start();
        await restarted.waitForIdle();
        expect(restarted.getSandbox(sandboxId)?.state).toBe("destroyed");
        expect(f.port.deleted).toEqual(["clone-1"]);
      } finally { await restarted.close(); }
    } finally { await first.close(); f.cleanup(); }
  });

  it("never accepts a personal VM ID for deletion", async () => {
    const f = fixture();
    const service = f.make();
    try {
      await service.start();
      await service.approveTemplate("template-vm");
      expect(() => service.destroySandbox("personal-vm")).toThrow(SandboxServiceError);
      expect(() => service.destroySandbox("template-vm")).toThrow(SandboxServiceError);
      expect(f.port.deleted).toEqual([]);
      expect(f.port.vms.has("personal-vm")).toBe(true);
    } finally { await service.close(); f.cleanup(); }
  });

  it("retries cleanup on restart after a delete failure", async () => {
    const f = fixture();
    const first = f.make();
    try {
      await first.start();
      const { sandboxId } = await ready(first);
      f.port.failAt = "delete";
      const { jobId } = first.destroySandbox(sandboxId);
      await first.waitForIdle();
      expect(first.getJob(jobId)?.state).toBe("failed");
      expect(first.getSandbox(sandboxId)?.state).toBe("destroying");
      await first.close();
      f.port.failAt = null;
      const restarted = f.make();
      try {
        await restarted.start();
        await restarted.waitForIdle();
        expect(restarted.getSandbox(sandboxId)?.state).toBe("destroyed");
        expect(f.port.deleted).toEqual(["clone-1"]);
      } finally { await restarted.close(); }
    } finally { await first.close(); f.cleanup(); }
  });
});
