export interface VM {
  id: string;
  name: string;
  status: string;
  backend: string;
  capabilities: Record<string, unknown>;
  network?: string;
  memoryMiB?: number;
  cpuCores?: number;
  architecture?: string;
  machine?: string;
  memoryMb?: number;
  serialPorts?: unknown;
  drives?: unknown;
  networkInterfaces?: unknown;
}

export type VmAction = "start" | "stop";

const CAPABILITY_KEYS = {
  start: ["start", "canStart"],
  stop: ["stop", "canStop"],
  serial: ["serial", "serialConsole"],
  display: ["display", "vnc", "vncDisplay"],
  guestExec: ["guestExec", "guestExecution"],
} as const;

export const hasCapability = (
  vm: Pick<VM, "capabilities">,
  kind: keyof typeof CAPABILITY_KEYS,
): boolean =>
  CAPABILITY_KEYS[kind].some((key) => vm.capabilities?.[key] === true);

const ACTIVE_STATUSES = new Set([
  "started",
  "running",
  "starting",
  "resuming",
  "paused",
  "pausing",
  "stopping",
]);

export const normalizeStatus = (status: string | undefined): string =>
  (status || "unknown").toLowerCase();

export const statusRank = (status: string): number => {
  const normalized = normalizeStatus(status);
  if (normalized === "started" || normalized === "running") return 0;
  if (normalized === "starting" || normalized === "resuming") return 1;
  if (normalized === "paused" || normalized === "pausing") return 2;
  if (normalized === "stopping") return 3;
  return 4;
};

export const statusLabel = (status: string): string => {
  const normalized = normalizeStatus(status);
  if (normalized === "started" || normalized === "running") return "Running";
  if (normalized === "stopped") return "Stopped";
  if (normalized === "paused") return "Paused";
  if (normalized === "starting") return "Starting";
  if (normalized === "stopping") return "Stopping";
  if (normalized === "pausing") return "Pausing";
  if (normalized === "resuming") return "Resuming";
  return status || "Unknown";
};

export const isStopped = (status: string): boolean =>
  normalizeStatus(status) === "stopped";

export const isRunning = (status: string): boolean => {
  const normalized = normalizeStatus(status);
  return normalized === "started" || normalized === "running";
};

export const canOpenConsole = (status: string): boolean => {
  const normalized = normalizeStatus(status);
  return (
    normalized === "started" ||
    normalized === "running" ||
    normalized === "paused"
  );
};

export const isBusyStatus = (status: string): boolean => {
  const normalized = normalizeStatus(status);
  return (
    normalized === "starting" ||
    normalized === "stopping" ||
    normalized === "pausing" ||
    normalized === "resuming"
  );
};

export const isActiveStatus = (status: string): boolean =>
  ACTIVE_STATUSES.has(normalizeStatus(status));

export const filterVms = (vms: VM[], query: string): VM[] => {
  const needle = query.trim().toLowerCase();
  const matched = needle
    ? vms.filter(
        (vm) =>
          vm.name.toLowerCase().includes(needle) ||
          vm.id.toLowerCase().includes(needle),
      )
    : vms;

  return [...matched].sort((a, b) => {
    const byStatus = statusRank(a.status) - statusRank(b.status);
    if (byStatus !== 0) return byStatus;
    return a.name.localeCompare(b.name);
  });
};

export const formatMemory = (mb: number | undefined): string => {
  if (mb == null || Number.isNaN(mb)) return "Unknown";
  if (mb >= 1024) {
    const gb = mb / 1024;
    return Number.isInteger(gb) ? `${gb} GB` : `${gb.toFixed(1)} GB`;
  }
  return `${mb} MB`;
};

export const friendlyListError = (message: string): string => {
  if (/failed to execute script|osascript|utm isn/i.test(message)) {
    return "UTM is not responding. Open UTM on this Mac, then retry.";
  }
  if (/failed to fetch|networkerror|load failed|econnrefused/i.test(message)) {
    return "Cannot reach the API. Confirm it is running and the API key matches.";
  }
  return message;
};

const labelOf = (item: unknown, index: number): string => {
  if (item && typeof item === "object" && !Array.isArray(item)) {
    const record = item as Record<string, unknown>;
    const name =
      record.Name ??
      record.name ??
      record.mode ??
      record.interface ??
      record.Mode;
    if (typeof name === "string" && name.trim()) return name;
  }
  if (typeof item === "string" && item.trim()) return item;
  return `Item ${index + 1}`;
};

export const summarizeList = (value: unknown, emptyLabel: string): string => {
  if (value == null) return "Unknown";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    if (value.length === 0) return emptyLabel;
    const names = value.slice(0, 4).map((item, index) => labelOf(item, index));
    const extra = value.length > 4 ? ` +${value.length - 4}` : "";
    return `${names.join(", ")}${extra}`;
  }
  return emptyLabel;
};

export interface SerialAvailability {
  available: boolean;
  text: string;
}

export const serialAvailability = (ports: unknown): SerialAvailability => {
  if (ports == null) {
    return {
      available: false,
      text: "Serial console is not available for this virtual machine.",
    };
  }

  if (typeof ports === "string") {
    const unavailable =
      ports.toLowerCase() === "unavailable" || ports.trim() === "";
    return {
      available: !unavailable,
      text: unavailable
        ? "Apple Virtualization virtual machines do not expose a serial console."
        : ports,
    };
  }

  if (Array.isArray(ports)) {
    if (ports.length === 0) {
      return {
        available: false,
        text: "This virtual machine has no serial ports. Add one in UTM, then try again.",
      };
    }
    return {
      available: true,
      text:
        ports.length === 1 ? "1 serial port" : `${ports.length} serial ports`,
    };
  }

  return { available: true, text: "Serial port configured" };
};
