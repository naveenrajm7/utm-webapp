import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test, expect } from "@jest/globals";
import { UtmAdapter, UtmError, ProcessRunner, ProcessResult, RunOptions, UtmPort } from "../index";
import { readSavedScreenshot } from "../screenshot";

const TEMPLATE = "11111111-1111-4111-8111-111111111111";
const CLONE = "22222222-2222-4222-8222-222222222222";

type FakeVm = {
  id: string; name: string; status: string; backend: string;
  networkInterfaces: { mode: string }[];
  serialPorts?: { interface: string }[];
  displays?: { hardware: string }[];
  vncArguments?: string[];
  icon?: string;
  architecture?: string;
  machine?: string;
  drives?: unknown[];
};

class FakeRunner implements ProcessRunner {
  calls: { file: string; args: string[]; options: RunOptions }[] = [];
  vms: FakeVm[] = [{ id: TEMPLATE, name: "Disposable Template", status: "stopped", backend: "qemu", networkInterfaces: [{ mode: "shared" }] }];
  cliAvailable = true;
  inventoryVersion: string | null = "5.0.6";
  fail?: { command: string; stderr: string; exitCode: number };
  detailOutput?: string;
  serialOutput?: string;

  async run(file: string, args: readonly string[], options: RunOptions): Promise<ProcessResult> {
    const list = [...args];
    this.calls.push({ file, args: list, options });
    const jxa = file === "osascript";
    const command = jxa ? list[3] : list[0];
    if (command === "version") return { stdout: this.cliAvailable ? "UTM 5.0.6\n" : "", stderr: "", exitCode: this.cliAvailable ? 0 : 134 };
    if (this.fail?.command === command) return { stdout: "", stderr: this.fail.stderr, exitCode: this.fail.exitCode };
    if (jxa && command === "list") return { stdout: JSON.stringify({ version: this.inventoryVersion, vms: this.vms }), stderr: "", exitCode: 0 };
    if (jxa && command === "detail") return { stdout: this.detailOutput ?? JSON.stringify(this.vm(list[4])), stderr: "", exitCode: 0 };
    if (jxa && command === "serial") return { stdout: this.serialOutput ?? JSON.stringify({ address: "/dev/ttys001" }), stderr: "", exitCode: 0 };
    if (jxa && command === "configure") {
      const vm = this.vm(list[4]);
      const config = JSON.parse(list[5]);
      if (config.network) vm.networkInterfaces = config.network === "offline" ? [] : [{ mode: "shared" }];
      if (config.name) vm.name = config.name;
    }
    if (command === "clone") {
      const name = jxa ? list[5] : list[2];
      this.vms.push({ ...this.vm(TEMPLATE), id: CLONE, name });
    }
    if (command === "start") this.vm(jxa ? list[4] : list[1]).status = "started";
    if (command === "stop") this.vm(jxa ? list[4] : list[2]).status = "stopped";
    if (command === "delete") this.vms = this.vms.filter(vm => vm.id !== (jxa ? list[4] : list[1]));
    if (command === "exec") {
      if (jxa) return { stdout: JSON.stringify({ stdoutData: Buffer.from("ok\n").toString("base64"), stderrData: "", exitCode: 0 }), stderr: "", exitCode: 0 };
      return { stdout: "ok\n", stderr: "", exitCode: 0 };
    }
    return { stdout: "{}", stderr: "", exitCode: 0 };
  }

  private vm(id: string): FakeVm {
    const vm = this.vms.find(item => item.id.toLowerCase() === id.toLowerCase());
    if (!vm) throw Error(`Fake VM not found: ${id}`);
    return vm;
  }
}

function adapter(fake: FakeRunner): UtmPort {
  return new UtmAdapter({ runner: fake, utmctlPath: "utmctl", osascriptPath: "osascript", scriptPath: "fixed.js" });
}

test("disposable clone flows through the port to guest execution and deletion", async () => {
  const fake = new FakeRunner();
  const port = adapter(fake);
  const clone = await port.cloneVm(TEMPLATE, "Disposable Run");
  expect(clone.id).toBe(CLONE);
  await port.configureVm(CLONE, { network: "offline" });
  expect((await port.getVm(CLONE)).network).toBe("offline");
  await port.startVm(CLONE);
  const result = await port.execInGuest(CLONE, ["/bin/echo", "a b", "$(touch /tmp/never)"], { timeoutMs: 2_000 });
  expect(result).toEqual({ stdout: "ok\n", stderr: "", exitCode: 0 });
  expect(fake.calls.find(call => call.args[0] === "exec")?.args).toEqual(["exec", CLONE, "--cmd", "/bin/echo", "a b", "$(touch /tmp/never)"]);
  await port.stopVm(CLONE);
  await port.deleteVm(CLONE);
  expect((await port.listVms()).map(vm => vm.id)).toEqual([TEMPLATE]);
});

test("inventory normalizes backend, network, and capabilities", async () => {
  const fake = new FakeRunner();
  fake.vms.push({ id: CLONE, name: "Apple", status: "started", backend: "apple", networkInterfaces: [{ mode: "bridged" }] });
  const port = adapter(fake);
  const vms = await port.listVms();
  expect(vms[0].capabilities.guestExec).toBe(false);
  expect(vms[1].network).toBe("other");
  expect(vms[1].networkInterfaces).toEqual([{ mode: "bridged" }]);
  expect(vms[1].capabilities.guestExec).toBe(false);
  expect(vms[1].capabilities.stop).toBe(true);
  expect(vms[0].capabilities).toMatchObject({ clone: false, configure: false, delete: false, guestExec: false });
  fake.inventoryVersion = null;
  expect(await port.getCapabilities()).toMatchObject({ utmVersion: "5.0.6", clone: false, configure: false, guestExec: false });
});

test("QEMU detail and configured consoles stay stable while stopped and running", async () => {
  const fake = new FakeRunner();
  fake.vms[0] = { ...fake.vms[0], serialPorts: [{ interface: "ptty" }],
    displays: [{ hardware: "virtio-ramfb" }], icon: "debian",
    vncArguments: ["-vnc", "127.0.0.1:2"], architecture: "aarch64", machine: "virt", drives: [{ id: "disk0" }] };
  const port = adapter(fake);
  const stopped = await port.getVm(TEMPLATE);
  expect((await port.getVm(TEMPLATE.toUpperCase())).id).toBe(TEMPLATE);
  expect(stopped).toMatchObject({ architecture: "aarch64", machine: "virt", drives: [{ id: "disk0" }], icon: "debian",
    capabilities: { serial: true, display: true } });
  expect((await port.listVms())[0].capabilities).toMatchObject({ serial: true, display: true });
  await expect(port.getSerialDevice(TEMPLATE)).rejects.toMatchObject({ code: "conflict" });
  await expect(port.getVncTarget(TEMPLATE)).rejects.toMatchObject({ code: "conflict" });
  fake.vms[0].status = "started";
  expect((await port.getVm(TEMPLATE)).capabilities).toMatchObject({ serial: true, display: true });
  expect(await port.getSerialDevice(TEMPLATE)).toBe("/dev/ttys001");
  expect(await port.getVncTarget(TEMPLATE)).toEqual({ host: "127.0.0.1", port: 5902 });
  expect(fake.calls.filter(call => call.file === "osascript").every(call => call.options.timeoutMs === 30_000)).toBe(true);
});

test("Apple PTY serial is configured but its display does not imply VNC", async () => {
  const fake = new FakeRunner();
  fake.vms[0] = { ...fake.vms[0], backend: "apple", status: "started",
    serialPorts: [{ interface: "ptty" }], vncArguments: ["-vnc 127.0.0.1:1"] };
  const port = adapter(fake);
  expect((await port.getVm(TEMPLATE)).capabilities).toMatchObject({ serial: true, display: false });
  expect(await port.getSerialDevice(TEMPLATE)).toBe("/dev/ttys001");
  await expect(port.getVncTarget(TEMPLATE)).rejects.toMatchObject({ code: "unsupported" });
});

test("a loopback VNC argument without a display card is not a graphical console", async () => {
  const fake = new FakeRunner();
  fake.vms[0] = { ...fake.vms[0], status: "started", serialPorts: [{ interface: "ptty" }],
    displays: [], vncArguments: ["-vnc", "127.0.0.1:1"] };
  const port = adapter(fake);
  expect((await port.getVm(TEMPLATE)).capabilities).toMatchObject({ serial: true, display: false });
  expect((await port.listVms())[0].capabilities.display).toBe(false);
  await expect(port.getVncTarget(TEMPLATE)).rejects.toMatchObject({ code: "unsupported", operation: "vnc" });
  fake.vms[0].displays = [{ hardware: "none" }];
  expect((await port.getVm(TEMPLATE)).capabilities.display).toBe(false);
  fake.vms[0].displays = [{ hardware: "virtio-gpu-pci" }];
  fake.vms[0].status = "stopped";
  expect((await port.getVm(TEMPLATE)).capabilities).toMatchObject({ display: true, start: true });
  await expect(port.getVncTarget(TEMPLATE)).rejects.toMatchObject({ code: "conflict" });
});

test("detail attaches a saved screenshot and inventory does not", async () => {
  const fake = new FakeRunner();
  fake.vms[0] = { ...fake.vms[0], displays: [{ hardware: "virtio-ramfb" }], vncArguments: ["-vnc", "127.0.0.1:1"] };
  let reads = 0;
  const port = new UtmAdapter({
    runner: fake, utmctlPath: "utmctl", osascriptPath: "osascript", scriptPath: "fixed.js",
    screenshotReader: async () => {
      reads += 1;
      return "data:image/png;base64,abcd";
    },
  });
  expect((await port.listVms())[0].screenshot).toBeUndefined();
  expect(reads).toBe(0);
  expect((await port.getVm(TEMPLATE)).screenshot).toBe("data:image/png;base64,abcd");
  const broken = new UtmAdapter({
    runner: fake, utmctlPath: "utmctl", osascriptPath: "osascript", scriptPath: "fixed.js",
    screenshotReader: async () => { throw new Error("unreadable"); },
  });
  expect((await broken.getVm(TEMPLATE)).screenshot).toBeUndefined();
  const unsafe = new UtmAdapter({
    runner: fake, utmctlPath: "utmctl", osascriptPath: "osascript", scriptPath: "fixed.js",
    screenshotReader: async () => "javascript:alert(1)",
  });
  expect((await unsafe.getVm(TEMPLATE)).screenshot).toBeUndefined();
  fake.vms[0] = { ...fake.vms[0], displays: [], vncArguments: ["-vnc", "127.0.0.1:1"] };
  const serialOnly = new UtmAdapter({
    runner: fake, utmctlPath: "utmctl", osascriptPath: "osascript", scriptPath: "fixed.js",
    screenshotReader: async () => "data:image/png;base64,abcd",
  });
  expect((await serialOnly.getVm(TEMPLATE)).screenshot).toBeUndefined();
});

test("missing or unsafe consoles are not advertised", async () => {
  const fake = new FakeRunner();
  fake.vms[0] = { ...fake.vms[0], status: "started", serialPorts: [{ interface: "tcp" }],
    vncArguments: ["-vnc", "0.0.0.0:1"] };
  const port = adapter(fake);
  expect((await port.getVm(TEMPLATE)).capabilities).toMatchObject({ serial: false, display: false });
  await expect(port.getSerialDevice(TEMPLATE)).rejects.toMatchObject({ code: "unsupported" });
  await expect(port.getVncTarget(TEMPLATE)).rejects.toMatchObject({ code: "unsupported" });
  fake.vms[0].serialPorts = [{ interface: "ptty" }];
  fake.serialOutput = JSON.stringify({ address: null });
  await expect(port.getSerialDevice(TEMPLATE)).rejects.toMatchObject({ code: "unavailable" });
});

test("malformed UTM detail and console output becomes a typed protocol error", async () => {
  const fake = new FakeRunner();
  const port = adapter(fake);
  fake.detailOutput = "not JSON";
  await expect(port.getVm(TEMPLATE)).rejects.toMatchObject({ code: "protocol_error", operation: "get" });
  fake.detailOutput = JSON.stringify({ ...fake.vms[0], serialPorts: "bad" });
  await expect(port.getVm(TEMPLATE)).rejects.toMatchObject({ code: "protocol_error", operation: "get" });
  fake.detailOutput = JSON.stringify({ ...fake.vms[0], displays: [{ hardware: 1 }] });
  await expect(port.getVm(TEMPLATE)).rejects.toMatchObject({ code: "protocol_error", operation: "get" });
  fake.detailOutput = JSON.stringify({ ...fake.vms[0], vncArguments: [42] });
  await expect(port.getVncTarget(TEMPLATE)).rejects.toMatchObject({ code: "protocol_error", operation: "vnc" });
  fake.detailOutput = JSON.stringify({ ...fake.vms[0], status: "started", serialPorts: [{ interface: "ptty" }] });
  fake.serialOutput = JSON.stringify({ address: 17 });
  await expect(port.getSerialDevice(TEMPLATE)).rejects.toMatchObject({ code: "protocol_error", operation: "serial" });
});

test("invalid VM identifiers and guest argv launch no process", async () => {
  const fake = new FakeRunner();
  const port = adapter(fake);
  await expect(port.deleteVm("; rm -rf /" )).rejects.toMatchObject({ code: "invalid_input" });
  await expect(port.execInGuest(TEMPLATE, ["/bin/sh", "bad\0arg"])).rejects.toMatchObject({ code: "invalid_input" });
  expect(fake.calls).toHaveLength(0);
});

test("JXA controls are used when utmctl is unavailable", async () => {
  const fake = new FakeRunner(); fake.cliAvailable = false;
  const port = adapter(fake);
  const clone = await port.cloneVm(TEMPLATE, "Disposable Run");
  await port.startVm(clone.id);
  expect(fake.calls.some(call => call.file === "osascript" && call.args[3] === "start")).toBe(true);
  expect(await port.execInGuest(clone.id, ["/bin/true"])).toEqual({ stdout: "ok\n", stderr: "", exitCode: 0 });
  expect((await port.getCapabilities()).utmctlAvailable).toBe(false);
});

test("UTM command failures become typed errors", async () => {
  const fake = new FakeRunner(); fake.fail = { command: "clone", stderr: "Error: Operation not supported by backend (-2700)", exitCode: 1 };
  await expect(adapter(fake).cloneVm(TEMPLATE, "Disposable Run")).rejects.toMatchObject({ code: "unsupported", operation: "clone" });
});

test("guest nonzero exit is returned while agent failure is typed", async () => {
  const fake = new FakeRunner(); fake.vms[0].status = "started";
  fake.fail = { command: "exec", stderr: "Error: application failed", exitCode: 7 };
  expect(await adapter(fake).execInGuest(TEMPLATE, ["/bin/false"])).toMatchObject({ exitCode: 7 });
  fake.fail.stderr = "Error: guest agent is not connected";
  await expect(adapter(fake).execInGuest(TEMPLATE, ["/bin/false"])).rejects.toMatchObject({ code: "unsupported" });
  fake.fail = { command: "exec", stderr: "Error from event: The QEMU guest agent is not running or not installed on the guest.", exitCode: 0 };
  await expect(adapter(fake).execInGuest(TEMPLATE, ["/bin/true"])).rejects.toMatchObject({ code: "unsupported" });
});

test("configuration rejects unsupported keys and active VMs", async () => {
  const fake = new FakeRunner();
  const port = adapter(fake);
  await expect(port.configureVm(TEMPLATE, { network: "bridged" as never })).rejects.toBeInstanceOf(UtmError);
  fake.vms[0].status = "started";
  await expect(port.configureVm(TEMPLATE, { network: "offline" })).rejects.toMatchObject({ code: "conflict" });
});

test("saved screenshots are read only from the matching VM package", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "utm-shots-"));
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const bundle = path.join(root, "Disposable.utm");
  await fs.mkdir(bundle);
  await fs.writeFile(path.join(bundle, "config.plist"), `<plist><key>UUID</key><string>${TEMPLATE}</string></plist>`);
  await fs.writeFile(path.join(bundle, "screenshot.png"), png);
  const other = path.join(root, "Other.utm");
  await fs.mkdir(other);
  await fs.writeFile(path.join(other, "config.plist"), "<plist><key>UUID</key><string>33333333-3333-4333-8333-333333333333</string></plist>");
  await fs.writeFile(path.join(other, "screenshot.png"), png);
  const outside = path.join(root, "escape.png");
  await fs.writeFile(outside, png);
  expect(await readSavedScreenshot(root, TEMPLATE)).toBe(`data:image/png;base64,${png.toString("base64")}`);
  await fs.rm(path.join(bundle, "screenshot.png"));
  await fs.symlink(outside, path.join(bundle, "screenshot.png"));
  expect(await readSavedScreenshot(root, TEMPLATE)).toBeUndefined();
  await fs.rm(path.join(bundle, "screenshot.png"));
  expect(await readSavedScreenshot(root, TEMPLATE)).toBeUndefined();
  await fs.writeFile(path.join(bundle, "screenshot.png"), Buffer.from("not a png"));
  expect(await readSavedScreenshot(root, TEMPLATE)).toBeUndefined();
  await fs.rm(root, { recursive: true, force: true });
});
