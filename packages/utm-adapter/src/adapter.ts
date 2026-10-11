import path from "node:path";
import { UtmError } from "./errors";
import { ProcessResult, ProcessRunner, RunOptions, SpawnRunner } from "./process";
import { acceptScreenshot, readSavedScreenshot, utmDocumentsDir } from "./screenshot";
import { GuestExecOptions, GuestExecResult, HostCapabilities, UtmPort, Vm, VmBackend, VmConfiguration, VmStatus, VncTarget } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_TIMEOUT_MS = 30_000;
const CONTROL_TIMEOUT_MS = 120_000;
const CLONE_TIMEOUT_MS = 10 * 60_000;
const MAX_OUTPUT_BYTES = 512 * 1024;

interface RawVm {
  id: unknown;
  name: unknown;
  status: unknown;
  backend: unknown;
  memoryMiB?: unknown;
  cpuCores?: unknown;
  networkInterfaces?: unknown;
  serialPorts?: unknown;
  displays?: unknown;
  vncArguments?: unknown;
  icon?: unknown;
  architecture?: unknown;
  machine?: unknown;
  drives?: unknown;
}

interface RawInventory { version?: unknown; vms?: unknown }

export interface UtmAdapterOptions {
  runner?: ProcessRunner;
  utmctlPath?: string;
  osascriptPath?: string;
  scriptPath?: string;
  /** Detail-only. Defaults to UTM's saved screenshot.png in the Documents container. */
  screenshotReader?: (id: string) => Promise<string | undefined>;
}

function validId(id: string): string {
  if (typeof id !== "string" || !UUID.test(id)) {
    throw new UtmError("invalid_input", "validate", "VM id must be a UUID");
  }
  return id;
}

function validName(name: string): string {
  const hasControl = typeof name === "string" && [...name].some(char => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127;
  });
  if (typeof name !== "string" || !name.trim() || name.length > 100 || hasControl) {
    throw new UtmError("invalid_input", "validate", "VM name must be 1–100 printable characters");
  }
  return name.trim();
}

function validArgv(argv: string[]): string[] {
  if (!Array.isArray(argv) || argv.length === 0 || argv.length > 128 ||
      argv.some(value => typeof value !== "string" || !value || value.includes("\0")) ||
      argv.reduce((length, value) => length + value.length, 0) > 16_384) {
    throw new UtmError("invalid_input", "exec", "argv must contain 1–128 nonempty arguments and at most 16 KiB");
  }
  return argv;
}

function validConfig(configuration: VmConfiguration): VmConfiguration {
  if (!configuration || typeof configuration !== "object" || Array.isArray(configuration)) {
    throw new UtmError("invalid_input", "configure", "Configuration must be an object");
  }
  const keys = Object.keys(configuration);
  if (!keys.length || keys.some(key => !["network", "name", "memoryMiB", "cpuCores"].includes(key))) {
    throw new UtmError("invalid_input", "configure", "Unsupported or empty configuration");
  }
  if (configuration.network !== undefined && !["offline", "shared"].includes(configuration.network)) {
    throw new UtmError("invalid_input", "configure", "Network must be offline or shared");
  }
  if (configuration.name !== undefined) validName(configuration.name);
  if (configuration.memoryMiB !== undefined && (!Number.isInteger(configuration.memoryMiB) || configuration.memoryMiB < 128 || configuration.memoryMiB > 1_048_576)) {
    throw new UtmError("invalid_input", "configure", "memoryMiB is out of range");
  }
  if (configuration.cpuCores !== undefined && (!Number.isInteger(configuration.cpuCores) || configuration.cpuCores < 0 || configuration.cpuCores > 256)) {
    throw new UtmError("invalid_input", "configure", "cpuCores is out of range");
  }
  return { ...configuration, ...(configuration.name === undefined ? {} : { name: validName(configuration.name) }) };
}

function parseJson(value: string, operation: string): unknown {
  try { return JSON.parse(value.trim()); }
  catch (error) { throw new UtmError("protocol_error", operation, "UTM returned invalid JSON", error); }
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Only a fixed loopback QEMU VNC argument can become a browser target. */
function vncTarget(args: unknown, operation: string): VncTarget | null {
  if (args === undefined) return null;
  if (!Array.isArray(args) || args.some(arg => typeof arg !== "string")) {
    throw new UtmError("protocol_error", operation, "UTM returned malformed QEMU arguments");
  }
  for (let i = 0; i < args.length; i++) {
    const value = args[i].trim();
    const target = value === "-vnc" ? args[i + 1] : value.startsWith("-vnc ") ? value.slice(5).trim() : null;
    if (target === null) continue;
    const match = /^(127\.0\.0\.1|localhost|\[::1\]):(\d{1,5})$/.exec(target);
    if (!match) return null;
    const port = 5900 + Number(match[2]);
    return port <= 65535 ? { host: match[1] === "[::1]" ? "::1" : match[1], port } : null;
  }
  return null;
}

/** A configured QEMU display card. Empty and "none" do not drive a graphical console. */
function hasGraphicalDisplay(displays: unknown): boolean {
  if (!Array.isArray(displays)) return false;
  return displays.some(display => {
    if (!record(display) || typeof display.hardware !== "string") return false;
    const hardware = display.hardware.trim().toLowerCase();
    return hardware !== "" && hardware !== "none";
  });
}

function failure(operation: string, result: ProcessResult): UtmError {
  const detail = (result.stderr || result.stdout).trim().slice(0, 512);
  if (/application (?:isn't running|not found|can't be found)|OSStatus -600/i.test(detail)) return new UtmError("unavailable", operation, detail);
  if (/VM_NOT_FOUND|not found|no such virtual machine/i.test(detail)) return new UtmError("not_found", operation, detail);
  if (/VM_NOT_STOPPED|must be stopped|already running|already exists/i.test(detail)) return new UtmError("conflict", operation, detail);
  if (/not authorized|not permitted|application (?:isn't running|not found|can't be found)|OSStatus -600/i.test(detail)) return new UtmError("unavailable", operation, detail);
  if (/not supported|guest agent|not available for this backend|\(-2700\)/i.test(detail)) return new UtmError("unsupported", operation, detail);
  return new UtmError("command_failed", operation, detail || `UTM command exited ${result.exitCode}`);
}

export class UtmAdapter implements UtmPort {
  private readonly runner: ProcessRunner;
  private readonly utmctlPath: string;
  private readonly osascriptPath: string;
  private readonly scriptPath: string;
  private cliAvailable?: boolean;
  private cliVersion: string | null = null;
  private readonly screenshotReader: (id: string) => Promise<string | undefined>;

  constructor(options: UtmAdapterOptions = {}) {
    this.runner = options.runner ?? new SpawnRunner();
    this.utmctlPath = options.utmctlPath ?? "/Applications/UTM.app/Contents/MacOS/utmctl";
    this.osascriptPath = options.osascriptPath ?? "/usr/bin/osascript";
    this.scriptPath = options.scriptPath ?? path.join(__dirname, "scripts", "utm.jxa.js");
    this.screenshotReader = options.screenshotReader ?? (id => readSavedScreenshot(utmDocumentsDir(), id));
  }

  private async run(file: string, args: string[], timeoutMs = DEFAULT_TIMEOUT_MS, maxOutputBytes = MAX_OUTPUT_BYTES): Promise<ProcessResult> {
    const options: RunOptions = { timeoutMs, maxOutputBytes };
    return this.runner.run(file, args, options);
  }

  private async cliWorks(): Promise<boolean> {
    if (this.cliAvailable !== undefined) return this.cliAvailable;
    try {
      const result = await this.run(this.utmctlPath, ["version"], 5_000, 16_384);
      this.cliAvailable = result.exitCode === 0;
      if (this.cliAvailable) this.cliVersion = result.stdout.match(/\b\d+\.\d+(?:\.\d+)?\b/)?.[0] ?? null;
    } catch {
      this.cliAvailable = false;
    }
    return this.cliAvailable;
  }

  private async jxa(action: string, args: string[] = [], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
    const result = await this.run(this.osascriptPath, ["-l", "JavaScript", this.scriptPath, action, ...args], timeoutMs);
    if (result.exitCode !== 0) throw failure(action, result);
    return result.stdout;
  }

  private async command(action: string, cliArgs: string[], jxaArgs: string[], timeoutMs = CONTROL_TIMEOUT_MS): Promise<ProcessResult> {
    if (await this.cliWorks()) {
      const result = await this.run(this.utmctlPath, cliArgs, timeoutMs);
      if (result.exitCode !== 0) throw failure(action, result);
      return result;
    }
    return { stdout: await this.jxa(action, jxaArgs, timeoutMs), stderr: "", exitCode: 0 };
  }

  private async inventory(): Promise<{ version: string | null; vms: RawVm[] }> {
    const data = parseJson(await this.jxa("list"), "list") as RawInventory;
    if (!data || !Array.isArray(data.vms)) throw new UtmError("protocol_error", "list", "UTM inventory is malformed");
    return { version: typeof data.version === "string" ? data.version : null, vms: data.vms as RawVm[] };
  }

  private normalize(raw: RawVm, operation = "list"): Vm {
    if (!raw || typeof raw.id !== "string" || !UUID.test(raw.id) || typeof raw.name !== "string") {
      throw new UtmError("protocol_error", operation, "UTM returned an invalid VM record");
    }
    if (raw.serialPorts !== undefined && (!Array.isArray(raw.serialPorts) || raw.serialPorts.some(port => !record(port) || typeof port.interface !== "string"))) {
      throw new UtmError("protocol_error", operation, "UTM returned malformed serial configuration");
    }
    if (raw.drives !== undefined && !Array.isArray(raw.drives)) {
      throw new UtmError("protocol_error", operation, "UTM returned malformed drive configuration");
    }
    if (raw.networkInterfaces !== undefined && (!Array.isArray(raw.networkInterfaces) || raw.networkInterfaces.some(nic => !record(nic) || typeof nic.mode !== "string"))) {
      throw new UtmError("protocol_error", operation, "UTM returned malformed network configuration");
    }
    if (raw.displays !== undefined && (!Array.isArray(raw.displays) || raw.displays.some(display => !record(display) || typeof display.hardware !== "string"))) {
      throw new UtmError("protocol_error", operation, "UTM returned malformed display configuration");
    }
    if (raw.icon !== undefined && typeof raw.icon !== "string") {
      throw new UtmError("protocol_error", operation, "UTM returned a malformed icon");
    }
    const backend = (["qemu", "apple", "unavailable"].includes(String(raw.backend)) ? raw.backend : "unavailable") as VmBackend;
    const status = (["stopped", "starting", "started", "pausing", "paused", "resuming", "stopping"].includes(String(raw.status)) ? raw.status : "unknown") as VmStatus;
    const modes = Array.isArray(raw.networkInterfaces) ? raw.networkInterfaces.map(nic => (nic as { mode: string }).mode) : [];
    const network = modes.length === 0 ? "offline" : modes.length === 1 && modes[0] === "shared" ? "shared" : "other";
    const usable = backend !== "unavailable";
    const serialPorts = raw.serialPorts as { interface: string }[] | undefined;
    const graphical = hasGraphicalDisplay(raw.displays);
    const vnc = backend === "qemu" ? vncTarget(raw.vncArguments, operation) : null;
    const display = usable && graphical && vnc !== null;
    const icon = typeof raw.icon === "string" ? raw.icon.trim() : "";
    return {
      id: raw.id, name: raw.name, status, backend, network,
      ...(Array.isArray(raw.networkInterfaces) ? { networkInterfaces: modes.map(mode => ({ mode })) } : {}),
      ...(icon ? { icon } : {}),
      ...(typeof raw.memoryMiB === "number" ? { memoryMiB: raw.memoryMiB } : {}),
      ...(typeof raw.cpuCores === "number" ? { cpuCores: raw.cpuCores } : {}),
      ...(typeof raw.architecture === "string" ? { architecture: raw.architecture } : {}),
      ...(typeof raw.machine === "string" ? { machine: raw.machine } : {}),
      ...(serialPorts ? { serialPorts } : {}),
      ...(Array.isArray(raw.drives) ? { drives: raw.drives } : {}),
      capabilities: {
        clone: false, configure: false,
        start: usable && (status === "stopped" || status === "paused"),
        stop: usable && (status === "started" || status === "paused"),
        delete: false,
        guestExec: false,
        guestAgent: backend === "qemu" ? "unknown" : "unavailable",
        networkPresets: [],
        serial: usable && !!serialPorts?.some(port => port.interface === "ptty"),
        display
      }
    };
  }

  async getCapabilities(): Promise<HostCapabilities> {
    const cli = await this.cliWorks();
    const inventory = await this.inventory();
    return { utmVersion: inventory.version ?? this.cliVersion, utmctlAvailable: cli, jxaAvailable: true, clone: false, configure: false, guestExec: false };
  }

  async listVms(): Promise<Vm[]> {
    const inventory = await this.inventory();
    return inventory.vms.map(vm => this.normalize(vm));
  }

  async getVm(id: string): Promise<Vm> {
    validId(id);
    const raw = parseJson(await this.jxa("detail", [id]), "get") as RawVm;
    const vm = this.normalize(raw, "get");
    if (vm.id.toLowerCase() !== id.toLowerCase()) throw new UtmError("protocol_error", "get", "UTM returned a different VM");
    if (vm.capabilities.display) {
      try {
        const screenshot = acceptScreenshot(await this.screenshotReader(vm.id));
        if (screenshot) vm.screenshot = screenshot;
      } catch {
        // A missing or unreadable preview must not hide the rest of the VM.
      }
    }
    return vm;
  }

  async getSerialDevice(id: string): Promise<string> {
    const vm = await this.getVm(id);
    if (!vm.capabilities.serial) throw new UtmError("unsupported", "serial", "VM has no PTY serial console");
    if (vm.status !== "started") throw new UtmError("conflict", "serial", "VM must be started");
    const result = parseJson(await this.jxa("serial", [id]), "serial");
    if (!record(result) || (result.address !== null && typeof result.address !== "string")) {
      throw new UtmError("protocol_error", "serial", "UTM returned a malformed serial target");
    }
    if (typeof result.address !== "string" || !/^\/dev\/(?:tty|pty)[A-Za-z0-9._-]+$/.test(result.address)) {
      throw new UtmError("unavailable", "serial", "Serial device is not connected");
    }
    return result.address;
  }

  async getVncTarget(id: string): Promise<VncTarget> {
    validId(id);
    const raw = parseJson(await this.jxa("detail", [id]), "vnc") as RawVm;
    const vm = this.normalize(raw, "vnc");
    if (vm.id.toLowerCase() !== id.toLowerCase()) throw new UtmError("protocol_error", "vnc", "UTM returned a different VM");
    const target = vm.backend === "qemu" ? vncTarget(raw.vncArguments, "vnc") : null;
    if (!vm.capabilities.display || !target) {
      const message = hasGraphicalDisplay(raw.displays)
        ? "VM has no loopback VNC display"
        : "VM has no graphical display device";
      throw new UtmError("unsupported", "vnc", message);
    }
    if (vm.status !== "started") throw new UtmError("conflict", "vnc", "VM must be started");
    return target;
  }

  async cloneVm(sourceId: string, name: string): Promise<Vm> {
    validId(sourceId); name = validName(name);
    const before = await this.listVms();
    const source = before.find(vm => vm.id.toLowerCase() === sourceId.toLowerCase());
    if (!source) throw new UtmError("not_found", "clone", `VM ${sourceId} was not found`);
    if (source.backend === "unavailable" || source.status !== "stopped") throw new UtmError("conflict", "clone", "Source VM must be stopped and available");
    if (before.some(vm => vm.name === name)) throw new UtmError("conflict", "clone", "VM name already exists");
    await this.command("clone", ["clone", "--name", name, sourceId], [sourceId, name], CLONE_TIMEOUT_MS);
    const knownIds = new Set(before.map(vm => vm.id.toLowerCase()));
    const created = (await this.listVms()).filter(vm => vm.name === name && !knownIds.has(vm.id.toLowerCase()));
    if (created.length !== 1) throw new UtmError("protocol_error", "clone", "Clone completed but its new UUID could not be uniquely identified");
    return created[0];
  }

  async configureVm(id: string, configuration: VmConfiguration): Promise<Vm> {
    validId(id); configuration = validConfig(configuration);
    const vm = await this.getVm(id);
    if (vm.backend === "unavailable" || vm.status !== "stopped") throw new UtmError("conflict", "configure", "VM must be stopped and available");
    await this.jxa("configure", [id, JSON.stringify(configuration)], CONTROL_TIMEOUT_MS);
    return this.getVm(id);
  }

  async startVm(id: string): Promise<void> {
    validId(id);
    const vm = await this.getVm(id);
    if (!vm.capabilities.start) throw new UtmError("conflict", "start", "VM is not stopped or paused");
    await this.command("start", ["start", id], [id]);
  }

  async stopVm(id: string): Promise<void> {
    validId(id);
    const vm = await this.getVm(id);
    if (!vm.capabilities.stop) throw new UtmError("conflict", "stop", "VM is not running or paused");
    await this.command("stop", ["stop", "--force", id], [id]);
  }

  async deleteVm(id: string): Promise<void> {
    validId(id);
    const vm = await this.getVm(id);
    if (vm.backend === "unavailable" || vm.status !== "stopped") throw new UtmError("conflict", "delete", "VM must be stopped and available");
    await this.command("delete", ["delete", id], [id]);
  }

  async execInGuest(id: string, argv: string[], options: GuestExecOptions = {}): Promise<GuestExecResult> {
    validId(id); validArgv(argv);
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 300_000) {
      throw new UtmError("invalid_input", "exec", "timeoutMs must be 1,000–300,000");
    }
    const vm = await this.getVm(id);
    if (vm.backend !== "qemu") throw new UtmError("unsupported", "exec", "Guest execution requires a QEMU guest agent");
    if (vm.status !== "started") throw new UtmError("conflict", "exec", "VM must be started");
    if (!(await this.cliWorks())) {
      const data = parseJson(await this.jxa("exec", [id, JSON.stringify(argv)], timeoutMs), "exec") as Record<string, unknown>;
      if (typeof data.exitCode !== "number") throw new UtmError("protocol_error", "exec", "UTM returned an invalid guest result");
      const stdout = typeof data.stdout === "string" ? data.stdout : Buffer.from(String(data.stdoutData ?? ""), "base64").toString("utf8");
      const stderr = typeof data.stderr === "string" ? data.stderr : Buffer.from(String(data.stderrData ?? ""), "base64").toString("utf8");
      return { stdout, stderr, exitCode: data.exitCode };
    }
    const result = await this.run(this.utmctlPath, ["exec", id, "--cmd", ...argv], timeoutMs);
    const detail = result.stderr.trim();
    if (/guest agent is not (?:running|installed|connected)/i.test(detail) ||
        (result.exitCode !== 0 && /(guest agent|not supported|VM_NOT_FOUND|not found|application not found|OSStatus -600|\(-2700\)|^Error: Missing expected argument)/i.test(detail))) {
      throw failure("exec", result);
    }
    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
  }
}
