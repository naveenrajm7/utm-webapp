/** HTTP-facing shape of the UTM adapter. Integration supplies the concrete implementation. */
export interface Vm {
  id: string;
  name: string;
  status: string;
  backend: string;
  capabilities: Record<string, boolean>;
  network?: string;
  networkInterfaces?: { mode: string }[];
  icon?: string;
  screenshot?: string;
  memoryMiB?: number;
  cpuCores?: number;
  architecture?: string;
  machine?: string;
  serialPorts?: unknown;
  drives?: unknown;
}

export interface HostCapabilities {
  utmVersion: string | null;
  features: Record<string, boolean>;
}

export interface JobRef {
  jobId: string;
}

export interface SandboxRef extends JobRef {
  sandboxId: string;
}

export interface Job {
  id: string;
  state: "queued" | "running" | "succeeded" | "failed";
  result?: unknown;
  error?: { code: string; message: string };
}

export interface UtmPort {
  getCapabilities(): Promise<HostCapabilities>;
  listVms(): Promise<Vm[]>;
  getVm(id: string): Promise<Vm>;
}

export interface PowerPort {
  startVm(id: string): Promise<JobRef>;
  stopVm(id: string): Promise<JobRef>;
  getJob(id: string): Promise<Job | null> | Job | null;
}

/** The sandbox service can be connected after VM power control is live. */
export interface SandboxPort {
  startVm(id: string): Promise<JobRef>;
  stopVm(id: string): Promise<JobRef>;
  listTemplates(): Promise<Vm[]>;
  createSandbox(input: {
    templateId: string;
    network: "offline" | "shared";
    ttlSeconds: number;
  }): Promise<SandboxRef>;
  getSandbox(id: string): Promise<unknown>;
  execSandbox(
    id: string,
    input: { argv: string[]; timeoutSeconds?: number },
  ): Promise<JobRef>;
  destroySandbox(id: string): Promise<JobRef>;
  getJob(id: string): Promise<Job>;
}

export interface ApiPorts {
  utm: UtmPort;
  sandbox: SandboxPort;
  power?: PowerPort;
}
