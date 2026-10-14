import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { after, before, test } from "node:test";
import { Browser, until } from "./cdp.mjs";
import { API_KEY, CLONE_ID, FakeApi, SOURCE_ID } from "./fake-api.mjs";

const fake = new FakeApi();
const browser = new Browser();
let web;
let webOutput = "";

const row = (name) => `.vm-row-main[title="${name}"]`;
const pending = () => browser.evaluate("sessionStorage.getItem('utm-pending-vm-job')");
const alertText = () => browser.text(".action-error");
const mutationCount = () => fake.mutations.length;
const lastJob = () => fake.mutations.at(-1).jobId;
const waitMutation = (count) => until(() => mutationCount() === count, `${count} mutation(s)`);
const waitRow = (name) => until(() => browser.exists(row(name)), `${name} in inventory`);
const waitNoJob = () => until(async () => !(await pending()), "pending job to clear", 10000);

async function clickButton(label, scope = "") {
  await browser.evaluate(`(() => {
    const root = ${scope ? `document.querySelector(${JSON.stringify(scope)})` : "document"};
    const button = [...root.querySelectorAll('button')].find((item) => item.textContent.trim() === ${JSON.stringify(label)});
    if (!button) throw new Error('Missing button: ${label}');
    button.click();
  })()`);
}

async function openSource() {
  await waitRow("Acceptance Source");
  await browser.click(row("Acceptance Source"));
  await until(() => browser.exists(".vm-management-actions"), "source details");
}

async function prepare() {
  fake.reset();
  await browser.navigate();
  await waitRow("Acceptance Source");
}

before(async () => {
  await fake.start();
  web = spawn(process.execPath, ["../../node_modules/next/dist/bin/next", "start", "-p", "3000"], {
    cwd: new URL("../../apps/web/", import.meta.url),
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [web.stdout, web.stderr])
    stream.on("data", (chunk) => { webOutput = (webOutput + chunk).slice(-4000); });
  await until(async () => {
    if (web.exitCode !== null) throw new Error(`Next exited: ${webOutput}`);
    return (await fetch("http://localhost:3000/")).ok;
  }, "Next on port 3000", 30000);
  await browser.start();
});

after(async () => {
  await browser.close();
  if (web && web.exitCode === null) {
    web.kill("SIGTERM");
    await new Promise((resolve) => web.once("exit", resolve));
  }
  await fake.close();
});

test("browser acceptance against deterministic fake API", { timeout: 180000 }, async (t) => {
  await t.test("unlock, reject invalid key, inventory and details", async () => {
    await browser.navigate();
    await until(() => browser.exists(".unlock-screen"), "unlock screen");
    assert.equal(fake.requests.length, 0, "locked page must not request inventory");
    await browser.fill('input[name="apiKey"]', "wrong-key");
    await clickButton("Unlock");
    await until(() => fake.requests.some((request) => request.auth === "Bearer wrong-key"), "rejected auth");
    await until(() => browser.exists(".unlock-screen"), "relocked screen");
    await browser.fill('input[name="apiKey"]', API_KEY);
    await clickButton("Unlock");
    await openSource();
    assert.match(await browser.text("#panel-details"), /4 GB/);
    assert.match(await browser.text("#panel-details"), /QEMU/);
    assert.match(await browser.text("#panel-details"), new RegExp(SOURCE_ID));
    assert.ok(fake.requests.some((request) => request.path === `/v1/vms/${SOURCE_ID}` && request.auth === `Bearer ${API_KEY}`));
    await browser.click('[aria-label="Lock"]');
    await until(() => browser.exists(".unlock-screen"), "lock screen");
    assert.equal(await browser.evaluate("sessionStorage.getItem('utm-api-key')"), null);
    await browser.fill('input[name="apiKey"]', API_KEY);
    await clickButton("Unlock");
    await waitRow("Acceptance Source");
  });

  await t.test("power jobs update inventory and details", async () => {
    await prepare();
    await openSource();
    await browser.click('[aria-label="Start virtual machine"]');
    await waitMutation(1);
    assert.equal(fake.mutations[0].path, `/v1/vms/${SOURCE_ID}/start`);
    assert.deepEqual(JSON.parse(await pending()), { jobId: lastJob(), vmId: SOURCE_ID, action: "start" });
    fake.finish(lastJob());
    await waitNoJob();
    await until(async () => (await browser.text(".toolbar-title-status")).includes("Running"), "running status");
    await browser.evaluate("window.confirm = () => true");
    await browser.click('[aria-label="Force stop virtual machine"]');
    await waitMutation(2);
    assert.equal(fake.mutations[1].path, `/v1/vms/${SOURCE_ID}/stop`);
    fake.finish(lastJob());
    await waitNoJob();
    await until(async () => (await browser.text(".toolbar-title-status")).includes("Stopped"), "stopped status");
  });

  await t.test("clone resumes after same-tab reload; settings and delete require confirmation", async () => {
    await prepare();
    await openSource();
    await clickButton("Clone", ".vm-management-actions");
    await browser.fill('[role="dialog"] input', "Acceptance Clone");
    await clickButton("Clone VM", '[role="dialog"]');
    await waitMutation(1);
    const cloneJob = lastJob();
    assert.deepEqual(fake.mutations[0].body, { name: "Acceptance Clone" });
    assert.deepEqual(JSON.parse(await pending()), { jobId: cloneJob, vmId: SOURCE_ID, action: "clone" });
    assert.equal((await pending()).includes(API_KEY), false);
    const pollsBeforeReload = fake.requests.filter((request) => request.path === `/v1/jobs/${cloneJob}`).length;
    await browser.navigate();
    await until(() => fake.requests.filter((request) => request.path === `/v1/jobs/${cloneJob}`).length > pollsBeforeReload, "resumed job poll");
    assert.equal(mutationCount(), 1, "reload must not submit a second clone");
    fake.finish(cloneJob);
    await waitRow("Acceptance Clone");
    await waitNoJob();
    assert.equal(mutationCount(), 1);
    await browser.click(row("Acceptance Clone"));
    await until(() => browser.exists(".vm-management-actions"), "clone details");
    await clickButton("Settings", ".vm-management-actions");
    await browser.fill('[role="dialog"] input:nth-of-type(1)', "Acceptance Clone Edited");
    await browser.fill('[role="dialog"] input[type="number"][min="128"]', "4352");
    await browser.fill('[role="dialog"] input[type="number"][min="0"]', "3");
    await clickButton("Save settings", '[role="dialog"]');
    await waitMutation(2);
    assert.deepEqual(fake.mutations[1].body, { name: "Acceptance Clone Edited", memoryMiB: 4352, cpuCores: 3 });
    fake.finish(lastJob());
    await waitRow("Acceptance Clone Edited");
    await waitNoJob();
    await browser.click(row("Acceptance Clone Edited"));
    await until(async () => (await browser.text("#panel-details")).includes("4.3 GB"), "edited detail");
    await clickButton("Delete", ".vm-management-actions");
    assert.equal(await browser.evaluate("document.querySelector('[role=dialog] button[type=submit]').disabled"), true);
    await browser.fill('[role="dialog"] input', "wrong name");
    assert.equal(await browser.evaluate("document.querySelector('[role=dialog] button[type=submit]').disabled"), true);
    assert.equal(mutationCount(), 2);
    await browser.fill('[role="dialog"] input', "Acceptance Clone Edited");
    assert.equal(await browser.evaluate("document.querySelector('[role=dialog] button[type=submit]').disabled"), false);
    await clickButton("Delete VM", '[role="dialog"]');
    await waitMutation(3);
    assert.deepEqual(fake.mutations[2].body, { confirmName: "Acceptance Clone Edited" });
    assert.equal(fake.mutations[2].path, `/v1/vms/${CLONE_ID}`);
    const deleteJob = lastJob();
    const deletePollsBeforeReload = fake.requests.filter((request) => request.path === `/v1/jobs/${deleteJob}`).length;
    await browser.navigate();
    await until(() => fake.requests.filter((request) => request.path === `/v1/jobs/${deleteJob}`).length > deletePollsBeforeReload, "resumed delete poll");
    assert.equal(mutationCount(), 3, "reload must not submit a second delete");
    fake.finish(deleteJob);
    await waitNoJob();
    await until(async () => !(await browser.exists(row("Acceptance Clone Edited"))), "clone removal");
    assert.equal(fake.vms.has(SOURCE_ID), true);
  });

  await t.test("unknown outcome preserves job ID and does not resubmit", async () => {
    await prepare();
    await openSource();
    await clickButton("Clone", ".vm-management-actions");
    await browser.fill('[role="dialog"] input', "Unknown Clone");
    await clickButton("Clone VM", '[role="dialog"]');
    await waitMutation(1);
    const jobId = lastJob();
    fake.finish(jobId, "unknown");
    await until(async () => (await alertText()).includes("outcome_unknown"), "unknown outcome message", 10000);
    assert.match(await alertText(), /Check the refreshed VM state/);
    assert.deepEqual(JSON.parse(await pending()), { jobId, vmId: SOURCE_ID, action: "clone" });
    await browser.navigate();
    await until(async () => (await alertText()).includes("outcome_unknown"), "unknown outcome after reload");
    assert.equal(mutationCount(), 1);
    assert.equal(fake.vms.has(CLONE_ID), false);
  });

  await t.test("missing job refreshes inventory without retrying the mutation", async () => {
    await browser.evaluate("sessionStorage.removeItem('utm-pending-vm-job')");
    await prepare();
    await openSource();
    await clickButton("Clone", ".vm-management-actions");
    await browser.fill('[role="dialog"] input', "Missing Job Clone");
    await clickButton("Clone VM", '[role="dialog"]');
    await waitMutation(1);
    const jobId = lastJob();
    fake.jobs.delete(jobId);
    await until(async () => (await alertText()).includes("job was not found"), "missing job message", 10000);
    assert.deepEqual(JSON.parse(await pending()), { jobId, vmId: SOURCE_ID, action: "clone" });
    assert.ok(fake.requests.filter((request) => request.path === "/v1/vms").length >= 2);
    await browser.navigate();
    await until(async () => (await alertText()).includes("job was not found"), "missing job after reload");
    assert.equal(mutationCount(), 1);
  });

  await t.test("stopped, unsupported, connected and disconnected serial states", async () => {
    await browser.evaluate("sessionStorage.removeItem('utm-pending-vm-job')");
    await prepare();
    await openSource();
    await browser.click('#tab-display');
    assert.match(await browser.text("#panel-display"), /Start Acceptance Source to open the display/);
    assert.equal(await browser.evaluate("document.querySelector('[aria-label=\"Open display in a new tab\"]').disabled"), true);
    await browser.navigate(`/terminal/${SOURCE_ID}`);
    await until(async () => (await browser.text(".console-gate")).includes("Start Acceptance Source"), "stopped serial gate");
    fake.vms.get(SOURCE_ID).capabilities.serial = false;
    await browser.click(".console-gate button");
    await until(async () => (await browser.text(".console-gate")).includes("no supported serial console"), "unsupported serial gate");
    fake.vms.get(SOURCE_ID).capabilities.serial = true;
    fake.vms.get(SOURCE_ID).status = "running";
    await browser.click(".console-gate button");
    await until(async () => (await browser.text(".terminal-hint")).includes("Connected"), "serial WebSocket connection");
    assert.equal(fake.serialSockets.size, 1);
    fake.closeSerial();
    await until(async () => (await browser.text(".terminal-hint")).includes("disconnected"), "serial disconnect");
  });
});
