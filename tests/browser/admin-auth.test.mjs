import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Browser, until } from "./cdp.mjs";

const require = createRequire(import.meta.url);
const runtimeRoot = process.env.BROWSER_RUNTIME_ROOT;
const { createProductionRuntime } = require(runtimeRoot
  ? join(runtimeRoot, "apps/api/dist/productionRuntime.js") : "../../apps/api/dist/productionRuntime.js");
const { AdminAuth, SESSION_TTL_MS } = require(runtimeRoot
  ? join(runtimeRoot, "apps/api/dist/adminAuth.js") : "../../apps/api/dist/adminAuth.js");
const id = "12345678-1234-1234-1234-123456789abc";
const port = Number(process.env.BROWSER_WEB_PORT);
const origin = `http://127.0.0.1:${port}`;
const password = "browser acceptance password";
const unavailable = async () => { throw new Error("No live UTM access in auth acceptance"); };
const vm = { id, name: "Authentication Test VM", status: "started", backend: "qemu", network: "shared",
  capabilities: { start: false, stop: false, clone: false, configure: false, delete: false,
    guestExec: false, guestAgent: "unavailable", networkPresets: [], serial: true, display: false } };
let serialResolutions = 0;
const adapter = {
  getCapabilities: async () => ({ utmVersion: "fake", utmctlAvailable: false, jxaAvailable: false,
    clone: false, configure: false, delete: false, guestExec: false }),
  listVms: async () => [vm], getVm: async () => vm,
  startVm: unavailable, stopVm: unavailable, cloneVm: unavailable, configureVm: unavailable,
  deleteVm: unavailable, getVncTarget: unavailable,
  getSerialDevice: async () => { serialResolutions++; return unavailable(); },
};

test("first launch, one-time admin setup, restart, login, consoles, logout, expiry and teardown", { timeout: 120000 }, async () => {
  const temp = await mkdtemp(join(tmpdir(), "utm-admin-browser-"));
  const filename = join(temp, "utm.sqlite");
  const browser = new Browser();
  let runtime, auth, now = Date.now();
  delete process.env.UTM_AUTH_MODE;
  // A former installation key must not bypass the admin login.
  process.env.UTM_API_KEY = "old-installation-key";
  process.env.UTM_API_JOB_JOURNAL_PATH = join(temp, "jobs.json");
  const start = async () => {
    auth = new AdminAuth(filename, () => now);
    runtime = await createProductionRuntime(adapter, { auth });
    await new Promise((resolve, reject) => {
      runtime.once("error", reject);
      runtime.listen(port, "127.0.0.1", resolve);
    });
  };
  const stop = async () => {
    if (runtime?.listening) await new Promise((resolve, reject) => runtime.close(error => error ? reject(error) : resolve()));
  };
  const heading = text => until(async () => (await browser.text("h1")) === text, text);
  const submit = () => browser.click('.unlock-sheet button[type="submit"]');
  const login = async () => {
    await heading("Log in to UTM Web");
    await browser.fill('input[name="username"]', "admin");
    await browser.fill('input[name="password"]', password);
    await submit();
    await until(() => browser.exists('.vm-row-main[title="Authentication Test VM"]'), "authenticated inventory");
  };
  try {
    await start();
    await browser.start();
    await browser.navigate();
    await heading("Set up UTM Web");
    assert.equal((await fetch(`${origin}/v1/vms`)).status, 401);
    assert.equal((await fetch(`${origin}/v1/vms`, { headers: { Authorization: "Bearer old-installation-key" } })).status, 401);
    await browser.fill('input[name="setupCode"]', "incorrect-code");
    await browser.fill('input[name="username"]', "admin");
    await browser.fill('input[name="password"]', password);
    await browser.fill('input[name="confirmPassword"]', "password does not match");
    await submit();
    await until(async () => (await browser.text('[role="alert"]')).includes("Passwords do not match"), "password confirmation");
    await browser.fill('input[name="confirmPassword"]', password);
    await submit();
    await until(async () => (await browser.text('[role="alert"]')).includes("Invalid setup code"), "setup code rejection");
    await browser.fill('input[name="setupCode"]', auth.setupCode);
    await submit();
    await heading("Log in to UTM Web");
    const status = await (await fetch(`${origin}/auth/status`)).json();
    assert.equal(status.setupRequired, false);
    assert.equal(status.authenticated, false);
    assert.equal((await stat(filename)).mode & 0o777, 0o600);
    assert.equal((await readFile(filename)).includes(Buffer.from(password)), false);
    // Restart the actual API + Next runtime using the same persisted database.
    await stop();
    await start();
    await browser.navigate();
    await heading("Log in to UTM Web");
    await browser.fill('input[name="username"]', "admin");
    await browser.fill('input[name="password"]', "an incorrect password");
    await submit();
    await until(async () => (await browser.text('[role="alert"]')).includes("Invalid username or password"), "bad password rejection");
    await login();
    assert.equal(await browser.evaluate("sessionStorage.getItem('utm-api-key')"), null);
    assert.equal(await browser.evaluate("document.cookie.includes('utm_session')"), false);
    const cookies = await browser.send("Network.getCookies", { urls: [origin] });
    const sessionCookie = cookies.cookies.find(cookie => cookie.name === "utm_session");
    assert.ok(sessionCookie?.httpOnly);
    const replay = `utm_session=${sessionCookie.value}`;
    const browserStatus = await browser.evaluate("fetch('/auth/status').then(r => r.json())");
    assert.equal(browserStatus.username, "admin");
    const csrf = browserStatus.csrf;
    assert.equal(await browser.evaluate("fetch('/auth/logout', {method:'POST',headers:{'X-UTM-Request':'1'}}).then(r=>r.status)"), 403);
    await browser.navigate();
    await until(() => browser.exists(".app-shell"), "session survives reload");
    await browser.navigate(`/terminal/${id}`);
    await until(() => serialResolutions > 0, "cookie-authenticated serial upgrade");
    await browser.navigate();
    await until(() => browser.exists(".app-shell"), "dashboard before logout");
    await browser.click('[aria-label="Log out"]');
    await heading("Log in to UTM Web");
    assert.equal((await fetch(`${origin}/v1/vms`, { headers: { Cookie: replay } })).status, 401);
    assert.equal((await fetch(`${origin}/auth/setup`, { method: "POST", headers: {
      Origin: origin, "X-UTM-Request": "1", "Content-Type": "application/json" },
      body: JSON.stringify({ username: "attacker", password, setupCode: auth.setupCode }) })).status, 409);
    await browser.navigate(`/terminal/${id}`);
    await heading("Log in to UTM Web");
    await browser.navigate();
    await login();
    await stop(); await start();
    await browser.navigate();
    await until(() => browser.exists(".app-shell"), "persisted session after API restart");
    now += SESSION_TTL_MS + 1;
    await browser.evaluate("fetch('/v1/vms').then(r => r.status)");
    await browser.navigate();
    await heading("Log in to UTM Web");
    await login();
    const newStatus = await browser.evaluate("fetch('/auth/status').then(r=>r.json())");
    assert.notEqual(newStatus.csrf, csrf);
    await browser.click('[aria-label="Log out"]');
    await heading("Log in to UTM Web");
  } finally {
    await browser.close();
    await stop();
    await rm(temp, { recursive: true, force: true });
  }
  await assert.rejects(stat(filename), { code: "ENOENT" });
});
