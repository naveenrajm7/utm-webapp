import { randomUUID } from "node:crypto";
import type { UtmPort as AdapterPort } from "@repo/utm-adapter";
import type { Job, JobRef, PowerPort } from "./ports";

type PowerAdapter = Pick<AdapterPort, "getVm" | "startVm" | "stopVm">;
type Action = "start" | "stop";

class PowerConflict extends Error {
  readonly code = "conflict";
}

/** Local asynchronous start/stop jobs used by the browser UI. */
export class VmPowerJobs implements PowerPort {
  private readonly jobs = new Map<string, Job>();
  private readonly active = new Set<string>();

  constructor(private readonly adapter: PowerAdapter) {}

  startVm(id: string): Promise<JobRef> {
    return this.enqueue(id, "start");
  }

  stopVm(id: string): Promise<JobRef> {
    return this.enqueue(id, "stop");
  }

  getJob(id: string): Job | null {
    return this.jobs.get(id) ?? null;
  }

  private async enqueue(id: string, action: Action): Promise<JobRef> {
    if (this.active.has(id)) throw new PowerConflict("VM already has a power job");
    this.active.add(id);
    try {
      const vm = await this.adapter.getVm(id);
      if (!vm.capabilities[action]) throw new PowerConflict(`VM cannot ${action} in its current state`);
      const jobId = randomUUID();
      const job: Job = { id: jobId, state: "queued" };
      this.jobs.set(jobId, job);
      this.prune();
      queueMicrotask(() => { void this.run(id, action, job); });
      return { jobId };
    } catch (error) {
      this.active.delete(id);
      throw error;
    }
  }

  private async run(id: string, action: Action, job: Job): Promise<void> {
    job.state = "running";
    try {
      if (action === "start") await this.adapter.startVm(id);
      else await this.adapter.stopVm(id);
      job.result = { vmId: id, status: (await this.adapter.getVm(id)).status };
      job.state = "succeeded";
    } catch (error) {
      const candidate = error as { code?: unknown; message?: unknown } | null;
      job.error = {
        code: typeof candidate?.code === "string" ? candidate.code : "internal",
        message: typeof candidate?.message === "string" ? candidate.message : "VM power operation failed",
      };
      job.state = "failed";
    } finally {
      this.active.delete(id);
    }
  }

  private prune(): void {
    if (this.jobs.size <= 256) return;
    for (const [id, job] of this.jobs) {
      if (job.state === "succeeded" || job.state === "failed") this.jobs.delete(id);
      if (this.jobs.size <= 256) break;
    }
  }
}
