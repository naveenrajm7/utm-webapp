const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { WebSocket } = require("ws");
const { createProductionRuntime } = require("../dist/productionRuntime");

const id = "12345678-1234-1234-1234-123456789abc";
const vm = {
  id, name: "Fake VM", status: "started", backend: "qemu", network: "offline",
  capabilities: { clone: false, configure: false, start: false, stop: true,
    delete: false, guestExec: false, guestAgent: "unavailable", networkPresets: [],
    serial: false, display: false },
};
const unavailable = async () => { throw new Error("unsupported"); };
const adapter = {
  getCapabilities: async () => ({ utmVersion: "fake", utmctlAvailable: true,
    jxaAvailable: true, clone: false, configure: false, delete: false, guestExec: false }),
  listVms: async () => [vm], getVm: async () => vm,
  startVm: unavailable, stopVm: unavailable, cloneVm: unavailable,
  configureVm: unavailable, deleteVm: unavailable,
  getSerialDevice: unavailable, getVncTarget: unavailable,
};

const closedConsole = (url, origin) => new Promise((resolve, reject) => {
  const ws = new WebSocket(url, { origin });
  const messages = [];
  const timer = setTimeout(() => { ws.terminate(); reject(new Error("console timeout")); }, 5000);
  ws.on("message", data => messages.push(data.toString()));
  ws.once("close", code => { clearTimeout(timer); resolve({ code, messages }); });
  ws.once("error", reject);
});

const main = async () => {
  const directory = mkdtempSync(join(tmpdir(), "utm-production-smoke-"));
  const key = randomBytes(24).toString("hex");
  process.env.UTM_API_KEY = key;
  process.env.UTM_API_JOB_JOURNAL_PATH = join(directory, "jobs.json");
  let server;
  try {
    server = await createProductionRuntime(adapter);
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (const route of ["/", `/terminal/${id}`, `/vnc/${id}`]) {
      for (let reload = 0; reload < 2; reload++) {
        const response = await fetch(origin + route);
        assert.equal(response.status, 200, `${route} reload ${reload}`);
        assert.match(await response.text(), /<!DOCTYPE html>/i);
      }
      console.log(`${route}: two HTTP loads passed`);
    }
    const index = await (await fetch(origin)).text();
    const asset = index.match(/src="(\/_next\/static\/[^\"]+\.js)"/);
    assert.ok(asset, "Next build asset appears in HTML");
    assert.equal((await fetch(origin + asset[1])).status, 200);
    for (const route of ["/.git/config", "/src/production.ts"])
      assert.equal((await fetch(origin + route)).status, 404, `${route} is private`);
    const inventory = await fetch(`${origin}/v1/vms`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    assert.equal(inventory.status, 200);
    assert.equal((await inventory.json())[0].id, id);
    assert.equal((await fetch(`${origin}/v1/unknown`, {
      headers: { Authorization: `Bearer ${key}` },
    })).status, 404);
    const wsOrigin = origin.replace(/^http:/, "ws:");
    const query = `?vmUUID=${id}&token=${key}`;
    const serial = await closedConsole(`${wsOrigin}/ws/serial${query}`, origin);
    assert.match(serial.messages.join(" "), /console unavailable/);
    const vnc = await closedConsole(`${wsOrigin}/ws/vnc${query}`, origin);
    assert.equal(vnc.code, 1011);
    console.log("build asset, static isolation, REST, serial and VNC: passed");
  } finally {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  }
};

main().catch(error => { console.error(error); process.exitCode = 1; });
