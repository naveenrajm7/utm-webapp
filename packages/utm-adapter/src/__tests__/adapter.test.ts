import { test, expect } from "@jest/globals";
import { UtmAdapter, UtmError, ProcessRunner, ProcessResult, RunOptions, UtmPort } from "../index";

const TEMPLATE = "11111111-1111-4111-8111-111111111111";
const CLONE = "22222222-2222-4222-8222-222222222222";

type FakeVm = { id: string; name: string; status: string; backend: string; networkInterfaces: { mode: string }[] };

class FakeRunner implements ProcessRunner {
  calls: { file: string; args: string[]; options: RunOptions }[] = [];
  vms: FakeVm[] = [{ id: TEMPLATE, name: "Disposable Template", status: "stopped", backend: "qemu", networkInterfaces: [{ mode: "shared" }] }];
  cliAvailable = true;
  inventoryVersion: string | null = "5.0.6";
  fail?: { command: string; stderr: string; exitCode: number };

  async run(file: string, args: readonly string[], options: RunOptions): Promise<ProcessResult> {
    const list = [...args];
    this.calls.push({ file, args: list, options });
    const jxa = file === "osascript";
    const command = jxa ? list[3] : list[0];
    if (command === "version") return { stdout: this.cliAvailable ? "UTM 5.0.6\n" : "", stderr: "", exitCode: this.cliAvailable ? 0 : 134 };
    if (this.fail?.command === command) return { stdout: "", stderr: this.fail.stderr, exitCode: this.fail.exitCode };
    if (jxa && command === "list") return { stdout: JSON.stringify({ version: this.inventoryVersion, vms: this.vms }), stderr: "", exitCode: 0 };
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
    const vm = this.vms.find(item => item.id === id);
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
  expect(vms[1].capabilities.guestExec).toBe(false);
  expect(vms[1].capabilities.stop).toBe(true);
  fake.inventoryVersion = null;
  expect((await port.getCapabilities()).utmVersion).toBe("5.0.6");
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
