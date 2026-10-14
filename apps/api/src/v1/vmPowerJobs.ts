import { randomUUID } from "node:crypto";
import type { UtmPort as AdapterPort, Vm as AdapterVm } from "@repo/utm-adapter";
import type { Job, JobRef, ManagementPort, PowerPort, VmEdit } from "./ports";
import { JobJournal } from "./jobJournal";

type PowerAdapter = Pick<AdapterPort, "getVm" | "startVm" | "stopVm">;
type ManagementAdapter = Pick<AdapterPort,
  "getCapabilities" | "listVms" | "cloneVm" | "configureVm" | "deleteVm">;
type Action = "start" | "stop";
type ManagementAction = "clone" | "configure" | "delete";

class OperationError extends Error {
  constructor(readonly code: "conflict" | "unsupported" | "service_unavailable" | "utm_failure", message: string) {
    super(message);
  }
}

const knownErrorCodes = new Set([
  "invalid_input", "invalid_argument", "not_found", "conflict", "unsupported",
  "unavailable", "timeout", "command_failed", "protocol_error", "output_limit",
  "utm_failure", "service_unavailable", "not_managed", "internal",
]);

const jobError = (error: unknown): NonNullable<Job["error"]> => {
  const candidate = error as { code?: unknown; message?: unknown } | null;
  const code = typeof candidate?.code === "string" && knownErrorCodes.has(candidate.code)
    ? candidate.code : "internal";
  return {
    code,
    message: code !== "internal" && typeof candidate?.message === "string"
      ? candidate.message : "VM operation failed",
  };
};

const sameName = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

/** One operation lock and durable job registry for legacy and /v1 actions. */
export class VmPowerJobs implements PowerPort, ManagementPort {
  private readonly journal: JobJournal;
  private readonly volatileJobs = new Map<string, Job>();
  private readonly active = new Set<string>();
  private readonly reservedNames = new Set<string>();

  constructor(private readonly adapter: PowerAdapter & Partial<ManagementAdapter>, journalPath?: string) {
    this.journal = new JobJournal(journalPath);
  }

  startVm(id: string): Promise<JobRef> { return this.power(id, "start"); }
  stopVm(id: string): Promise<JobRef> { return this.power(id, "stop"); }
  getJob(id: string): Job | null { return this.volatileJobs.get(id) ?? this.journal.get(id); }

  cloneVm(id: string, name: string): Promise<JobRef> {
    return this.enqueue(id, async () => {
      await this.checkManagement(id, "clone");
      const before = await this.managementAdapter().listVms();
      if (before.some(vm => sameName(vm.name, name)))
        throw new OperationError("conflict", "VM name already exists");
    }, async () => {
      const adapter = this.managementAdapter();
      const before = await adapter.listVms();
      await this.checkManagement(id, "clone");
      if (before.some(vm => sameName(vm.name, name)))
        throw new OperationError("conflict", "VM name already exists");
      const knownIds = new Set(before.map(vm => vm.id.toLowerCase()));
      let created: AdapterVm | undefined;
      let mutationError: unknown;
      try { created = await adapter.cloneVm(id, name); }
      catch (error) { mutationError = error; }
      let after: AdapterVm[];
      try { after = await adapter.listVms(); }
      catch (error) { throw this.unknownOutcome(mutationError ?? error); }
      const matches = after.filter(vm => sameName(vm.name, name) && !knownIds.has(vm.id.toLowerCase()));
      if (matches.length === 1 && (!created || created.id.toLowerCase() === matches[0].id.toLowerCase()))
        return { vmId: matches[0].id };
      if (mutationError) throw this.unknownOutcome(mutationError);
      throw new OperationError("utm_failure", "Clone was not uniquely present in inventory; refresh before retrying");
    }, name);
  }

  configureVm(id: string, patch: VmEdit): Promise<JobRef> {
    const check = async () => {
      await this.checkManagement(id, "configure");
      if (patch.name !== undefined) {
        const inventory = await this.managementAdapter().listVms();
        if (inventory.some(vm => vm.id.toLowerCase() !== id.toLowerCase() &&
            sameName(vm.name, patch.name!)))
          throw new OperationError("conflict", "VM name already exists");
      }
    };
    return this.enqueue(id, check, async () => {
      await check();
      let mutationError: unknown;
      try { await this.managementAdapter().configureVm(id, patch); }
      catch (error) { mutationError = error; }
      let vm: AdapterVm;
      try { vm = await this.adapter.getVm(id); }
      catch (error) { throw this.unknownOutcome(mutationError ?? error); }
      const matches = Object.entries(patch).every(([key, value]) => vm[key as keyof AdapterVm] === value);
      if (matches && vm.status === "stopped") return { vmId: id, status: "stopped" };
      if (mutationError) throw this.unknownOutcome(mutationError);
      throw new OperationError("utm_failure", "VM edit was not confirmed by readback");
    }, patch.name);
  }

  deleteVm(id: string, confirmName: string): Promise<JobRef> {
    return this.enqueue(id, async () => {
      const vm = await this.checkManagement(id, "delete");
      if (vm.name !== confirmName)
        throw new OperationError("conflict", "Confirmation must match the current VM name");
    }, async () => {
      const vm = await this.checkManagement(id, "delete");
      if (vm.name !== confirmName)
        throw new OperationError("conflict", "Confirmation must match the current VM name");
      let mutationError: unknown;
      try { await this.managementAdapter().deleteVm(id); }
      catch (error) { mutationError = error; }
      let after: AdapterVm[];
      try { after = await this.managementAdapter().listVms(); }
      catch (error) { throw this.unknownOutcome(mutationError ?? error); }
      if (!after.some(item => item.id.toLowerCase() === id.toLowerCase()))
        return { vmId: id, deleted: true };
      if (mutationError) throw this.unknownOutcome(mutationError);
      throw new OperationError("utm_failure", "VM still appears in inventory after delete");
    });
  }

  private managementAdapter(): ManagementAdapter {
    const adapter = this.adapter;
    if (!adapter.getCapabilities || !adapter.listVms || !adapter.cloneVm ||
        !adapter.configureVm || !adapter.deleteVm)
      throw new OperationError("service_unavailable", "VM management is not configured");
    return adapter as PowerAdapter & ManagementAdapter;
  }

  private async checkManagement(id: string, action: ManagementAction): Promise<AdapterVm> {
    const vm = await this.adapter.getVm(id);
    if (vm.status !== "stopped")
      throw new OperationError("conflict", "VM must be stopped");
    const host = await this.managementAdapter().getCapabilities();
    // The shared base adapter type has no delete host flag yet. Missing means disabled.
    const hostEnabled = (host as typeof host & { delete?: boolean })[action] === true;
    if (vm.backend === "unavailable" || !hostEnabled || vm.capabilities[action] !== true)
      throw new OperationError("unsupported", "VM " + action + " is not available");
    return vm;
  }

  private power(id: string, action: Action): Promise<JobRef> {
    const check = async () => {
      const vm = await this.adapter.getVm(id);
      if (!vm.capabilities[action])
        throw new OperationError("conflict", "VM cannot " + action + " in its current state");
    };
    return this.enqueue(id, check, async () => {
      await check();
      if (action === "start") await this.adapter.startVm(id);
      else await this.adapter.stopVm(id);
      return { vmId: id, status: (await this.adapter.getVm(id)).status };
    });
  }

  private async enqueue<T>(id: string, admit: () => Promise<T>,
    operate: (admitted: T) => Promise<unknown>, desiredName?: string): Promise<JobRef> {
    const vmKey = id.toLowerCase();
    const nameKey = desiredName?.toLowerCase();
    if (this.active.has(vmKey)) throw new OperationError("conflict", "VM already has an operation job");
    if (nameKey && this.reservedNames.has(nameKey))
      throw new OperationError("conflict", "VM name is reserved by another job");
    this.active.add(vmKey);
    if (nameKey) this.reservedNames.add(nameKey);
    try {
      const admitted = await admit();
      const jobId = randomUUID();
      const job: Job = { id: jobId, state: "queued" };
      this.journal.insert(job);
      queueMicrotask(() => {
        void (async () => {
          try {
            this.journal.update({ id: jobId, state: "running" });
          } catch (error) {
            const failed: Job = { id: jobId, state: "failed", error: jobError(error) };
            try { this.journal.update(failed); }
            catch { this.volatileJobs.set(jobId, failed); }
            this.active.delete(vmKey);
            if (nameKey) this.reservedNames.delete(nameKey);
            return;
          }
          let terminal: Job;
          try {
            terminal = { id: jobId, state: "succeeded", result: await operate(admitted) };
          } catch (error) {
            terminal = { id: jobId, state: "failed", error: jobError(error) };
          }
          try { this.journal.update(terminal); }
          catch {
            this.volatileJobs.set(jobId, { id: jobId, state: "unknown", error: {
              code: "outcome_unknown",
              message: "Cannot persist the completed job; inspect refreshed VM state before another action",
            } });
          }
          this.active.delete(vmKey);
          if (nameKey) this.reservedNames.delete(nameKey);
        })();
      });
      return { jobId };
    } catch (error) {
      this.active.delete(vmKey);
      if (nameKey) this.reservedNames.delete(nameKey);
      throw error;
    }
  }

  private unknownOutcome(error: unknown): Error & { code: string } {
    const typed = jobError(error);
    return Object.assign(new Error(typed.message + "; refresh inventory before retrying"), { code: typed.code });
  }

}
