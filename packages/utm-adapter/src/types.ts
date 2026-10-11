/** Stable UUIDs are the only VM identifiers accepted by the adapter. */
export type VmStatus = "stopped" | "starting" | "started" | "pausing" | "paused" | "resuming" | "stopping" | "unknown";
export type VmBackend = "qemu" | "apple" | "unavailable";
export type NetworkPreset = "offline" | "shared";

export interface VmCapabilities {
  clone: boolean;
  configure: boolean;
  start: boolean;
  stop: boolean;
  delete: boolean;
  /** The command path exists; the guest agent may still be absent. */
  guestExec: boolean;
  /** Agent readiness cannot be determined without executing in the guest. */
  guestAgent: "unknown" | "unavailable";
  networkPresets: NetworkPreset[];
  /** Configured PTY serial console, independent of power state. */
  serial: boolean;
  /** Configured loopback QEMU VNC target, independent of power state. */
  display: boolean;
}

export interface Vm {
  id: string;
  name: string;
  status: VmStatus;
  backend: VmBackend;
  capabilities: VmCapabilities;
  network: NetworkPreset | "other";
  memoryMiB?: number;
  cpuCores?: number;
  architecture?: string;
  machine?: string;
  serialPorts?: { interface: string }[];
  drives?: unknown[];
}

export interface VncTarget { host: string; port: number }

export interface HostCapabilities {
  utmVersion: string | null;
  utmctlAvailable: boolean;
  jxaAvailable: boolean;
  clone: boolean;
  configure: boolean;
  delete: boolean;
  guestExec: boolean;
}

export interface VmConfiguration {
  name?: string;
  memoryMiB?: number;
  cpuCores?: number;
}

export interface GuestExecOptions {
  timeoutMs?: number;
}

export interface GuestExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Inject this port into API and sandbox services; no service needs process access. */
export interface UtmPort {
  getCapabilities(): Promise<HostCapabilities>;
  listVms(): Promise<Vm[]>;
  getVm(id: string): Promise<Vm>;
  getSerialDevice(id: string): Promise<string>;
  getVncTarget(id: string): Promise<VncTarget>;
  cloneVm(sourceId: string, name: string): Promise<Vm>;
  configureVm(id: string, configuration: VmConfiguration): Promise<Vm>;
  startVm(id: string): Promise<void>;
  stopVm(id: string): Promise<void>;
  deleteVm(id: string): Promise<void>;
  execInGuest(id: string, argv: string[], options?: GuestExecOptions): Promise<GuestExecResult>;
}
