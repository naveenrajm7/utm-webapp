import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { mkdtempSync, rmSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createServer as createTcpServer } from "node:net";
import supertest from "supertest";
import { WebSocket } from "ws";
import { AdminAuth, SESSION_COOKIE, SESSION_TTL_MS } from "../adminAuth";
import { createLocalRuntime } from "../localRuntime";

const ID = "12345678-1234-1234-1234-123456789abc";
const PASSWORD = "a good test password";
const unavailable = async (): Promise<never> => { throw new Error("unsupported"); };
const adapter = {
  getCapabilities: async () => ({ utmVersion: "fake", utmctlAvailable: false, jxaAvailable: false,
    clone: false, configure: false, delete: false, guestExec: false }),
  listVms: async () => [], getVm: unavailable,
  startVm: unavailable, stopVm: unavailable, cloneVm: unavailable, configureVm: unavailable,
  deleteVm: unavailable, getSerialDevice: unavailable, getVncTarget: unavailable,
};

describe("local administrator authentication", () => {
  let directory: string, filename: string, auth: AdminAuth, server: Server, origin: string, now: number;
  const oldMode = process.env.UTM_AUTH_MODE;
  const oldJournal = process.env.UTM_API_JOB_JOURNAL_PATH;
  const start = async () => {
    auth = new AdminAuth(filename, () => now);
    server = createLocalRuntime(adapter, { auth, singleOrigin: true });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  };
  const stop = () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  const post = (path: string) => supertest(server).post(`/auth/${path}`).set("Origin", origin).set("X-UTM-Request", "1");
  const setup = () => post("setup").send({ username: "admin", password: PASSWORD, setupCode: auth.setupCode });
  const login = () => post("login").send({ username: "admin", password: PASSWORD });
  const cookie = (response: { headers: Record<string, unknown> }) => (response.headers["set-cookie"] as string[])[0]!.split(";")[0]!;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "utm-auth-test-"));
    filename = join(directory, "utm.sqlite");
    now = Date.now();
    process.env.UTM_AUTH_MODE = "session";
    process.env.UTM_API_JOB_JOURNAL_PATH = join(directory, "jobs.json");
    await start();
  });
  afterEach(async () => {
    if (server.listening) await stop();
    rmSync(directory, { recursive: true, force: true });
    if (oldMode === undefined) delete process.env.UTM_AUTH_MODE; else process.env.UTM_AUTH_MODE = oldMode;
    if (oldJournal === undefined) delete process.env.UTM_API_JOB_JOURNAL_PATH; else process.env.UTM_API_JOB_JOURNAL_PATH = oldJournal;
  });

  it("requires protected one-time setup, stores hashes, and creates only one administrator", async () => {
    const status = await supertest(server).get("/auth/status").expect(200);
    expect(status.body).toEqual({ mode: "session", setupRequired: true, authenticated: false });
    expect(status.headers["cache-control"]).toBe("no-store");
    await supertest(server).get("/v1/vms").expect(401);
    await post("setup").send({ username: "admin", password: PASSWORD, setupCode: "wrong" }).expect(403);
    await post("setup").send({ username: "admin", password: "short", setupCode: auth.setupCode }).expect(400);
    await setup().expect(201);
    await setup().expect(409);
    await supertest(server).get("/v1/vms").expect(401);
    expect(statSync(filename).mode & 0o777).toBe(0o600);
    expect(readFileSync(filename).includes(Buffer.from(PASSWORD))).toBe(false);
    const result = await login().expect(200);
    const header = (result.headers["set-cookie"] as unknown as string[])[0]!;
    expect(header).toContain("HttpOnly"); expect(header).toContain("SameSite=Strict");
    expect(readFileSync(filename).includes(Buffer.from(cookie(result).split("=")[1]!))).toBe(false);
    await supertest(server).get("/v1/vms").set("Cookie", cookie(result)).expect(200, []);
  });

  it("rejects bad login, forged hosts, CSRF, and the previous API key in session mode", async () => {
    await setup().expect(201);
    await post("login").send({ username: "admin", password: "incorrect password" }).expect(401);
    const result = await login().expect(200), sessionCookie = cookie(result);
    await supertest(server).get("/auth/status").set("Host", "attacker.example").expect(403);
    await supertest(server).post("/auth/login").send({ username: "admin", password: PASSWORD }).expect(403);
    await supertest(server).post("/auth/login").set("Origin", "https://attacker.example").set("X-UTM-Request", "1").send({}).expect(403);
    await supertest(server).get("/v1/vms").set("Authorization", "Bearer old-key").expect(401);
    // The installation health key is deliberately not a VM credential.
    const previousKey = process.env.UTM_API_KEY;
    process.env.UTM_API_KEY = "installation-test-key";
    try {
      await supertest(server).get("/auth/installation").expect(401);
      await supertest(server).get("/auth/installation").set("X-API-Key", "installation-test-key")
        .expect(200, { service: "utm-web", ready: true });
      await supertest(server).get("/v1/vms").set("X-API-Key", "installation-test-key").expect(401);
    } finally {
      if (previousKey === undefined) delete process.env.UTM_API_KEY; else process.env.UTM_API_KEY = previousKey;
    }
    await supertest(server).post(`/v1/vms/${ID}/start`).set("Cookie", sessionCookie).expect(403);
    await post("logout").set("Cookie", sessionCookie).expect(403);
    await post("logout").set("Cookie", sessionCookie).set("X-UTM-CSRF", result.body.csrf).expect(200);
    await supertest(server).get("/v1/vms").set("Cookie", sessionCookie).expect(401);
    await post("logout").set("Cookie", sessionCookie).set("X-UTM-CSRF", result.body.csrf).expect(401);
  });

  it("admits a VM job with the session CSRF token and rejects cross-origin mutations", async () => {
    await stop();
    auth = new AdminAuth(filename, () => now);
    let status: "stopped" | "started" = "stopped";
    let starts = 0;
    const vm = () => ({ id: ID, name: "Fake VM", status, backend: "qemu" as const, network: "shared" as const,
      capabilities: { start: status === "stopped", stop: status === "started", clone: false,
        configure: false, delete: false, guestExec: false, guestAgent: "unavailable" as const,
        networkPresets: [], serial: false, display: false } });
    server = createLocalRuntime({ ...adapter, getVm: async () => vm(), listVms: async () => [vm()],
      startVm: async () => { starts++; status = "started"; } }, { auth, singleOrigin: true });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await setup().expect(201);
    const result = await login().expect(200), sessionCookie = cookie(result);
    await supertest(server).post(`/v1/vms/${ID}/start`).set("Cookie", sessionCookie)
      .set("Origin", "http://attacker.example").set("X-UTM-CSRF", result.body.csrf).expect(403);
    expect(starts).toBe(0);
    const accepted = await supertest(server).post(`/v1/vms/${ID}/start`).set("Cookie", sessionCookie)
      .set("Origin", origin).set("X-UTM-CSRF", result.body.csrf).expect(202);
    expect(accepted.body.jobId).toEqual(expect.any(String));
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(starts).toBe(1);
    await supertest(server).get(`/v1/jobs/${accepted.body.jobId}`).set("Cookie", sessionCookie).expect(200);
  });

  it("persists setup and sessions across restart, then expires and revokes sessions", async () => {
    await setup().expect(201);
    const result = await login().expect(200), sessionCookie = cookie(result);
    await stop();
    await start();
    expect((await supertest(server).get("/auth/status").set("Cookie", sessionCookie).expect(200)).body.username).toBe("admin");
    await setup().expect(409);
    now += SESSION_TTL_MS + 1;
    await supertest(server).get("/v1/vms").set("Cookie", sessionCookie).expect(401);
    const second = await login().expect(200);
    await post("logout").set("Cookie", cookie(second)).set("X-UTM-CSRF", second.body.csrf).expect(200);
    await stop(); await start();
    await supertest(server).get("/v1/vms").set("Cookie", cookie(second)).expect(401);
  });

  it("bounds login attempts and recovers after the cooldown", async () => {
    await setup().expect(201);
    for (let i = 0; i < 5; i++) await post("login").send({ username: "admin", password: "wrong long password" }).expect(401);
    const limited = await login().expect(429);
    expect(limited.headers["retry-after"]).toBe("60");
    now += 60001;
    await login().expect(200);
  }, 15000);

  it("admits one administrator under concurrent setup and fails closed on a broken database", async () => {
    const second = new AdminAuth(filename);
    try {
      const outcomes = await Promise.allSettled([
        auth.setup("first", PASSWORD, auth.setupCode), second.setup("second", PASSWORD, second.setupCode),
      ]);
      expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
      expect(outcomes.filter(result => result.status === "rejected")).toHaveLength(1);
    } finally { second.close(); }
    expect(() => new AdminAuth(directory)).toThrow();
  });

  it("authenticates console upgrades with cookies and closes active consoles on logout", async () => {
    const target = createTcpServer();
    await new Promise<void>(resolve => target.listen(0, "127.0.0.1", resolve));
    await stop();
    auth = new AdminAuth(filename, () => now);
    server = createLocalRuntime({ ...adapter, getVncTarget: async () => ({ host: "127.0.0.1", port: (target.address() as AddressInfo).port }) }, { auth, singleOrigin: true });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await setup().expect(201);
    const result = await login().expect(200);
    const url = `${origin.replace("http:", "ws:")}/ws/vnc?vmUUID=${ID}`;
    const denied = new WebSocket(url, { origin });
    await new Promise<void>((resolve, reject) => {
      denied.on("unexpected-response", (_req, response) => { expect(response.statusCode).toBe(401); response.resume(); denied.terminate(); resolve(); });
      denied.on("error", () => {}); denied.on("open", () => reject(new Error("Unauthenticated console opened")));
    });
    const ws = new WebSocket(url, ["binary"], { origin, headers: { Cookie: cookie(result) } });
    try {
      await new Promise<void>((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
      const closed = new Promise<number>(resolve => ws.once("close", resolve));
      await post("logout").set("Cookie", cookie(result)).set("X-UTM-CSRF", result.body.csrf).expect(200);
      expect(await closed).toBe(1008);
    } finally { ws.terminate(); await new Promise<void>(resolve => target.close(() => resolve())); }
  });
});
