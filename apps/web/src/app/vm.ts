export interface VM {
  id: string;
  name: string;
  status: string;
  backend: string;
  capabilities: Record<string, unknown>;
  network?: string;
  networkInterfaces?: unknown;
  icon?: string;
  /** PNG data URL for a saved UTM screenshot. */
  screenshot?: string;
  memoryMiB?: number;
  cpuCores?: number;
  architecture?: string;
  machine?: string;
  memoryMb?: number;
  serialPorts?: unknown;
  drives?: unknown;
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
  return isRunning(status);
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

export const formatCpuCores = (cores: number | undefined): string => {
  if (cores == null || Number.isNaN(cores)) return "Unknown";
  if (cores === 0) return "Automatic";
  return String(cores);
};

const NETWORK_MODES: Record<string, string> = {
  offline: "Offline",
  shared: "Shared Network",
  emulated: "Emulated VLAN",
  host: "Host Only",
  bridged: "Bridged",
};

const modeText = (mode: string): string => NETWORK_MODES[mode] ?? mode;

/** Prefer UTM's configured NIC modes over the collapsed offline/shared/other summary. */
export const networkLabel = (
  vm: Pick<VM, "network" | "networkInterfaces">,
): string => {
  if (Array.isArray(vm.networkInterfaces) && vm.networkInterfaces.length > 0) {
    const labels = vm.networkInterfaces.map((item, index) => {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const mode = (item as { mode?: unknown }).mode;
        if (typeof mode === "string" && mode.trim()) return modeText(mode.trim());
      }
      return labelOf(item, index);
    });
    return labels.join(", ");
  }
  if (typeof vm.network === "string" && vm.network.trim()) {
    if (vm.network === "other") return "Other";
    return NETWORK_MODES[vm.network] ?? vm.network;
  }
  return "Unknown";
};

export const formatMemory = (mb: number | undefined): string => {
  if (mb == null || Number.isNaN(mb)) return "Unknown";
  if (mb >= 1024) {
    const gb = mb / 1024;
    return Number.isInteger(gb) ? `${gb} GB` : `${gb.toFixed(1)} GB`;
  }
  return `${mb} MB`;
};

export const backendLabel = (backend: string | undefined): string => {
  if (backend === "qemu") return "QEMU";
  if (backend === "apple") return "Apple Virtualization";
  return backend || "Unknown";
};

export interface OsBadge {
  icon: string;
  tone: "ubuntu" | "windows" | "apple" | "linux" | "android" | "generic";
}

const UBUNTU_ICONS = new Set(["ubuntu", "kubuntu", "lubuntu", "xubuntu"]);
const WINDOWS_ICONS = new Set([
  "windows",
  "windows-11",
  "windows7",
  "windows-xp",
  "windows-9x",
]);
const APPLE_ICONS = new Set(["mac", "ios", "apple-tv"]);
const ANDROID_ICONS = new Set(["android", "cyanogenmod"]);
const LINUX_ICONS = new Set([
  "linux",
  "debian",
  "fedora",
  "arch-linux",
  "alpine",
  "centos",
  "almalinux",
  "gentoo",
  "mint",
  "nixos",
  "suse",
  "red-hat",
  "elementary-os",
  "pop-os",
  "slackware",
  "openwrt",
  "knoppix",
  "backtrack",
  "mandriva",
  "pardus",
  "sabayon",
  "kali",
]);

const badgeForIcon = (icon: string | undefined): OsBadge | null => {
  if (!icon) return null;
  const name = icon.trim().toLowerCase().replace(/\.png$/, "");
  if (!name || name === "generic") return null;
  if (UBUNTU_ICONS.has(name)) return { icon: "bi-ubuntu", tone: "ubuntu" };
  if (WINDOWS_ICONS.has(name)) return { icon: "bi-windows", tone: "windows" };
  if (APPLE_ICONS.has(name)) return { icon: "bi-apple", tone: "apple" };
  if (ANDROID_ICONS.has(name)) return { icon: "bi-android2", tone: "android" };
  if (LINUX_ICONS.has(name)) return { icon: "bi-terminal-fill", tone: "linux" };
  return null;
};

/** Prefer UTM's configured icon, then the guest name. */
export const osBadge = (vm: Pick<VM, "name" | "backend" | "icon">): OsBadge =>
  badgeForIcon(vm.icon) ?? osBadgeFromName(vm);

const osBadgeFromName = (vm: Pick<VM, "name" | "backend">): OsBadge => {
  const name = vm.name.toLowerCase();
  if (name.includes("ubuntu")) return { icon: "bi-ubuntu", tone: "ubuntu" };
  if (name.includes("windows")) return { icon: "bi-windows", tone: "windows" };
  if (vm.backend === "apple" || /mac ?os|sequoia|sonoma|ventura/.test(name))
    return { icon: "bi-apple", tone: "apple" };
  if (name.includes("android")) return { icon: "bi-android2", tone: "android" };
  if (/linux|debian|fedora|arch|alpine|kali|centos|rocky|alma|suse|mint/.test(name))
    return { icon: "bi-terminal-fill", tone: "linux" };
  return { icon: "bi-pc-display", tone: "generic" };
};

export const statusTone = (status: string): string => {
  const normalized = normalizeStatus(status);
  if (normalized === "started" || normalized === "running") return "is-running";
  if (normalized === "paused") return "is-paused";
  if (isBusyStatus(status)) return "is-busy";
  if (normalized === "stopped") return "is-stopped";
  return "is-unknown";
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
