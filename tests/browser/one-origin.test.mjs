import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { Browser, until } from "./cdp.mjs";
import { API_KEY, SOURCE_ID } from "./fake-api.mjs";

const require = createRequire(import.meta.url);
const { createProductionRuntime } = require("../../apps/api/dist/productionRuntime.js");
const port = Number(process.env.BROWSER_WEB_PORT);
const origin = `http://127.0.0.1:${port}`;
const browser = new Browser();
const vm = {
  id: SOURCE_ID, name: "One Origin Source", status: "started", backend: "qemu",
  network: "shared", memoryMiB: 4096, cpuCores: 2,
  serialPorts: [{ interface: "serial0" }],
  capabilities: {
    start: false, stop: true, clone: false, configure: false, delete: false,
    guestExec: false, guestAgent: "unavailable", networkPresets: [],
    serial: true, display: true,
  },
};
const observed = { upgrades: [], serialResolutions: 0, vncResolutions: 0, vncConnections: 0 };
let runtime;
let vncTarget;
let temp;
const vncSockets = new Set();

const adapter = {
  async getCapabilities() {
    return { utmVersion: "fake", utmctlAvailable: false, jxaAvailable: false,
      clone: false, configure: false, delete: false, guestExec: false };
  },
  async listVms() { return [{ ...vm, capabilities: { ...vm.capabilities } }]; },
  async getVm(id) {
    if (id !== SOURCE_ID) throw new Error("VM not found");
    return { ...vm, capabilities: { ...vm.capabilities } };
  },
  async getSerialDevice() {
    observed.serialResolutions++;
    throw new Error("fake serial transport closed");
  },
  async getVncTarget() {
    observed.vncResolutions++;
    return { host: "127.0.0.1", port: vncTarget.address().port };
  },
  async startVm() { throw new Error("Unexpected live mutation"); },
  async stopVm() { throw new Error("Unexpected live mutation"); },
  async cloneVm() { throw new Error("Unexpected live mutation"); },
  async configureVm() { throw new Error("Unexpected live mutation"); },
  async deleteVm() { throw new Error("Unexpected live mutation"); },
};

async function clickButton(label, scope = "") {
  await browser.evaluate(`(() => {
    const root = ${scope ? `document.querySelector(${JSON.stringify(scope)})` : "document"};
    const button = [...root.querySelectorAll('button')].find((item) => item.textContent.trim() === ${JSON.stringify(label)});
    if (!button) throw new Error('Missing button: ${label}');
    button.click();
  })()`);
}

before(async () => {
  temp = await mkdtemp(join(tmpdir(), "utm-one-origin-acceptance-"));
  process.env.UTM_API_KEY = API_KEY;
  process.env.UTM_API_JOB_JOURNAL_PATH = join(temp, "jobs.json");
  vncTarget = createServer((socket) => {
    observed.vncConnections++;
    vncSockets.add(socket);
    socket.on("close", () => vncSockets.delete(socket));
    socket.write("RFB 003.008\n");
  });
  await new Promise((resolve, reject) => {
    vncTarget.once("error", reject);
    vncTarget.listen(0, "127.0.0.1", resolve);
  });
  runtime = await createProductionRuntime(adapter);
  runtime.on("upgrade", (request) => observed.upgrades.push({
    path: new URL(request.url, origin).pathname,
    host: request.headers.host,
    origin: request.headers.origin,
  }));
  await new Promise((resolve, reject) => {
    runtime.once("error", reject);
    runtime.listen(port, "127.0.0.1", resolve);
  });
  await browser.start();
});

after(async () => {
  await browser.close();
  for (const socket of vncSockets) socket.destroy();
  if (runtime) await new Promise((resolve) => runtime.close(resolve));
  if (vncTarget) await new Promise((resolve) => vncTarget.close(resolve));
  if (temp) await rm(temp, { recursive: true, force: true });
});

test("production one-origin runtime serves fake REST and both console upgrades", { timeout: 60000 }, async () => {
  await browser.navigate();
  await until(() => browser.exists(".unlock-screen"), "one-origin unlock");
  await browser.fill('input[name="apiKey"]', API_KEY);
  await clickButton("Unlock");
  await until(() => browser.exists('.vm-row-main[title="One Origin Source"]'), "one-origin inventory");
  const inventory = await fetch(`${origin}/v1/vms`, { headers: { Authorization: `Bearer ${API_KEY}` } });
  assert.equal(inventory.status, 200);
  assert.equal((await inventory.json())[0].id, SOURCE_ID);

  vm.capabilities.serial = false;
  await browser.navigate(`/terminal/${SOURCE_ID}`);
  await until(async () => (await browser.text(".console-gate")).includes("no supported serial console"), "one-origin unsupported serial");
  assert.equal(observed.serialResolutions, 0);
  vm.capabilities.serial = true;
  await clickButton("Refresh status", ".console-gate");
  await until(() => observed.serialResolutions >= 1, "one-origin serial upgrade");
  await until(async () => (await browser.text(".console-gate")).includes("connection was lost"), "one-origin serial disconnect");
  const beforeReconnect = observed.serialResolutions;
  await clickButton("Reconnect", ".console-gate");
  await until(() => observed.serialResolutions > beforeReconnect, "one-origin serial reconnect");
  const beforeReload = observed.serialResolutions;
  await browser.navigate(`/terminal/${SOURCE_ID}`);
  await until(() => observed.serialResolutions > beforeReload, "one-origin serial direct reload");
  assert.ok(observed.upgrades.filter((item) => item.path === "/ws/serial").length >= 3);

  vm.capabilities.display = false;
  await browser.navigate(`/vnc/${SOURCE_ID}`);
  await until(async () => (await browser.text(".console-gate")).includes("no supported display console"), "one-origin unsupported display");
  assert.equal(observed.vncResolutions, 0);
  vm.capabilities.display = true;
  await clickButton("Refresh status", ".console-gate");
  await until(() => observed.vncResolutions >= 1 && observed.vncConnections >= 1, "one-origin VNC bridge");
  assert.ok(observed.upgrades.some((item) => item.path === "/ws/vnc"));
  for (const upgrade of observed.upgrades) {
    assert.equal(upgrade.host, `127.0.0.1:${port}`);
    assert.equal(upgrade.origin, origin);
  }
});
