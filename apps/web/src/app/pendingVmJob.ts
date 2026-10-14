import type { VmAction } from "./vm";

export type PendingVmAction = VmAction | "clone" | "configure" | "delete";
export interface PendingVmJob {
  jobId: string;
  vmId: string;
  action: PendingVmAction;
}

export const PENDING_VM_JOB_KEY = "utm-pending-vm-job";
const actions: PendingVmAction[] = ["start", "stop", "clone", "configure", "delete"];

export const readPendingVmJob = (): PendingVmJob | null => {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(PENDING_VM_JOB_KEY);
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (value && typeof value === "object") {
      const { jobId, vmId, action } = value as Record<string, unknown>;
      if (typeof jobId === "string" && jobId.length > 0 &&
        typeof vmId === "string" && vmId.length > 0 &&
        actions.includes(action as PendingVmAction)) {
        return { jobId, vmId, action: action as PendingVmAction };
      }
    }
  } catch { /* Discard malformed metadata. */ }
  sessionStorage.removeItem(PENDING_VM_JOB_KEY);
  return null;
};

export const savePendingVmJob = (pending: PendingVmJob): void => {
  sessionStorage.setItem(PENDING_VM_JOB_KEY, JSON.stringify({
    jobId: pending.jobId, vmId: pending.vmId, action: pending.action,
  }));
};

export const clearPendingVmJob = (): void => {
  if (typeof window !== "undefined") sessionStorage.removeItem(PENDING_VM_JOB_KEY);
};
