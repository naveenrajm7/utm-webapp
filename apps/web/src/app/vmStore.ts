import { getJob, getVm, jobError, listVms, powerVm, type Job } from "./v1";
import { friendlyListError, hasCapability, type VM, type VmAction } from "./vm";

type VmApi = Pick<typeof import("./v1"), "getJob" | "getVm" | "listVms" | "powerVm">;
const api: VmApi = { getJob, getVm, listVms, powerVm };

export interface VmSnapshot {
  vms: VM[];
  loading: boolean;
  error: string | null;
  busyUuid: string | null;
  actionError: string | null;
  actionJob: { action: VmAction; state: Job["state"] } | null;
  selectedId: string | null;
  selected: VM | null;
  detailsLoading: boolean;
  detailsError: string | null;
}

export class VmStore {
  private listeners = new Set<() => void>();
  private state: VmSnapshot = {
    vms: [], loading: true, error: null, busyUuid: null, actionError: null,
    actionJob: null, selectedId: null, selected: null,
    detailsLoading: false, detailsError: null,
  };
  private detail: { vm: VM; inventoryStatus: string } | null = null;
  private listRequest = 0;
  private detailRequest = 0;
  private checkingJob = false;
  private pending: { id: string; action: VmAction } | null = null;

  constructor(private readonly client: VmApi = api) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = () => this.state;
  private publish = (change: Partial<VmSnapshot>) => {
    this.state = { ...this.state, ...change };
    this.listeners.forEach((listener) => listener());
  };
  private listed = () =>
    this.state.vms.find((vm) => vm.id === this.state.selectedId) ?? null;
  private current = (listed: VM): VM => {
    const detail = this.detail?.vm;
    if (!detail || detail.id !== listed.id) return listed;
    return {
      ...listed,
      ...detail,
      status: listed.status,
      capabilities: {
        ...detail.capabilities,
        ...listed.capabilities,
        // Inventory has no console configuration yet. Retain the last confirmed
        // flags until the detail request for the new power state completes.
        serial: hasCapability(detail, "serial"),
        display: hasCapability(detail, "display"),
      },
    };
  };

  select = (id: string | null) => {
    if (this.state.selectedId === id) return;
    this.detailRequest++;
    this.detail = null;
    this.publish({
      selectedId: id,
      selected: this.state.vms.find((vm) => vm.id === id) ?? null,
      detailsError: null,
      detailsLoading: Boolean(id),
    });
    if (id) void this.refreshSelected();
  };

  refresh = async () => {
    const request = ++this.listRequest;
    try {
      const vms = await this.client.listVms();
      if (request !== this.listRequest) return;
      if (!Array.isArray(vms)) throw new Error("The API returned an invalid VM list.");
      const selectedId = this.state.selectedId;
      const listed = vms.find((vm) => vm.id === selectedId) ?? null;
      const previousStatus = this.listed()?.status;
      if (!listed && selectedId) {
        this.detailRequest++;
        this.detail = null;
      }
      this.publish({
        vms, loading: false, error: null,
        selectedId: listed ? selectedId : null,
        selected: listed ? this.current(listed) : null,
        detailsLoading: listed !== null && listed.status !== previousStatus
          ? true : this.state.detailsLoading,
      });
      if (listed) await this.refreshSelected();
    } catch (caught) {
      if (request !== this.listRequest) return;
      this.publish({
        loading: false,
        error: friendlyListError(
          caught instanceof Error ? caught.message : "Failed to list virtual machines",
        ),
      });
    }
  };

  refreshSelected = async () => {
    const listed = this.listed();
    if (!listed) return;
    const request = ++this.detailRequest;
    if (!this.detail || this.detail.inventoryStatus !== listed.status) {
      this.publish({ detailsLoading: true, detailsError: null, selected: this.current(listed) });
    }
    try {
      const vm = await this.client.getVm(listed.id);
      if (request !== this.detailRequest || this.state.selectedId !== listed.id) return;
      const latest = this.listed();
      if (!latest || latest.status !== listed.status) return;
      this.detail = { vm, inventoryStatus: latest.status };
      this.publish({ selected: this.current(latest), detailsLoading: false, detailsError: null });
    } catch (caught) {
      if (request !== this.detailRequest || this.state.selectedId !== listed.id) return;
      this.publish({
        detailsLoading: false,
        detailsError: caught instanceof Error ? caught.message : "Could not load virtual machine details",
      });
    }
  };

  runAction = async (id: string, action: VmAction) => {
    if (this.state.busyUuid) return;
    const vm = this.state.selected?.id === id
      ? this.state.selected : this.state.vms.find((item) => item.id === id);
    if (!vm || !hasCapability(vm, action)) return;
    this.publish({ actionError: null, busyUuid: id });
    try {
      const result = await this.client.powerVm(id, action);
      if (!result.jobId) throw new Error("The API did not return a job ID.");
      this.pending = { id: result.jobId, action };
      this.publish({ actionJob: { action, state: "queued" } });
      await this.pollJob();
    } catch (caught) {
      this.publish({
        busyUuid: null,
        actionError: caught instanceof Error ? caught.message : `Could not ${action} the virtual machine`,
      });
      await this.refreshActualState();
    }
  };

  pollJob = async () => {
    const pending = this.pending;
    if (!pending || this.checkingJob) return;
    this.checkingJob = true;
    try {
      const job = await this.client.getJob(pending.id);
      if (this.pending !== pending) return;
      if (job.state === "succeeded" || job.state === "failed") {
        await this.refreshActualState();
        this.finishJob(job.state === "failed" ? jobError(job) : null);
      } else {
        this.publish({ actionJob: { action: pending.action, state: job.state } });
      }
    } catch {
      if (this.pending !== pending) return;
      await this.refreshActualState();
      this.finishJob(
        "The power job is unavailable. Check its current status before retrying.",
      );
    } finally {
      this.checkingJob = false;
    }
  };

  private finishJob = (error: string | null) => {
    this.pending = null;
    this.publish({ busyUuid: null, actionJob: null, actionError: error });
  };
  private refreshActualState = async () => {
    this.detailRequest++;
    const listed = this.listed();
    this.publish({ selected: listed ? this.current(listed) : null,
      detailsLoading: Boolean(this.state.selectedId) });
    await this.refresh();
    if (this.state.selectedId && this.state.error) await this.refreshSelected();
  };
  dismissActionError = () => this.publish({ actionError: null });
}
