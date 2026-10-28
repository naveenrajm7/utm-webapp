import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RequestListener, Server } from "node:http";
import type { AddressInfo } from "node:net";
import supertest from "supertest";
import { WebSocket } from "ws";
import type { Vm } from "@repo/utm-adapter";
import { createProductionRuntime } from "../productionRuntime";
import type { InjectableAdapter } from "../localRuntime";

const KEY = "fake-production-key";
const ID = "12345678-1234-1234-1234-123456789abc";
const wsAuth = (binary = false) => ["utm-auth", `utm-auth.${Buffer.from(KEY).toString("base64url")}`,
  ...(binary ? ["binary"] : [])];
const vm: Vm = {
  id: ID, name: "Fake VM", status: "started", backend: "qemu", network: "offline",
  capabilities: { clone: false, configure: false, start: false, stop: true,
    delete: false, guestExec: false, guestAgent: "unavailable", networkPresets: [],
    serial: false, display: false },
};

const html: RequestListener = (req, res) => {
  const path = new URL(req.url || "/", "http://localhost").pathname;
  if (path === "/" || path === `/terminal/${ID}` || path === `/vnc/${ID}`) {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(`<main data-route="${path}">UTM Web</main>`);
  } else {
    res.statusCode = 404;
    res.end("Page not found");
  }
};

const upgradeStatus = (url: string, origin?: string, authorized = true): Promise<number> =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(url, authorized ? wsAuth(url.includes("/vnc")) : [], origin ? { origin } : undefined);
    const timer = setTimeout(() => { ws.terminate(); reject(new Error("upgrade timed out")); }, 5000);
    ws.once("unexpected-response", (_req, response) => {
      clearTimeout(timer);
      response.resume();
      resolve(response.statusCode || 0);
    });
    ws.once("open", () => { clearTimeout(timer); ws.close(); reject(new Error("upgrade unexpectedly succeeded")); });
    ws.once("error", () => { /* ws emits this after a rejected handshake */ });
  });

const unavailableConsole = (url: string, origin: string): Promise<{ code: number; messages: string[] }> =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(url, wsAuth(url.includes("/vnc")), { origin });
    const messages: string[] = [];
    const timer = setTimeout(() => { ws.terminate(); reject(new Error("console did not close")); }, 5000);
    ws.on("message", data => messages.push(data.toString()));
    ws.once("close", code => { clearTimeout(timer); resolve({ code, messages }); });
    ws.once("error", reject);
  });

describe("single origin production runtime with a fake adapter", () => {
  let directory: string;
  let server: Server;
  let port: number;
  const lookups: string[] = [];

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "utm-single-origin-"));
    process.env.UTM_API_JOB_JOURNAL_PATH = join(directory, "jobs.json");
    process.env.UTM_AUTH_MODE = "api-key";
    process.env.UTM_API_KEY = KEY;
    lookups.length = 0;
    const adapter: InjectableAdapter = {
      getCapabilities: async () => ({ utmVersion: "fake", utmctlAvailable: true,
        jxaAvailable: true, clone: false, configure: false, delete: false, guestExec: false }),
      listVms: async () => [vm],
      getVm: async () => vm,
      startVm: async () => { throw new Error("Unexpected mutation"); },
      stopVm: async () => { throw new Error("Unexpected mutation"); },
      cloneVm: async () => { throw new Error("Unexpected mutation"); },
      configureVm: async () => { throw new Error("Unexpected mutation"); },
      deleteVm: async () => { throw new Error("Unexpected mutation"); },
      getSerialDevice: async id => { lookups.push(`serial:${id}`); throw new Error("unsupported"); },
      getVncTarget: async id => { lookups.push(`vnc:${id}`); throw new Error("unsupported"); },
    };
    server = await createProductionRuntime(adapter, { webHandler: html });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
    delete process.env.UTM_API_JOB_JOURNAL_PATH;
    delete process.env.UTM_API_KEY;
    delete process.env.UTM_AUTH_MODE;
  });

  it("reloads VM and console pages while preserving authenticated REST shapes", async () => {
    const request = supertest(server);
    for (const route of ["/", `/terminal/${ID}`, `/vnc/${ID}`]) {
      for (let reload = 0; reload < 2; reload++) {
        const response = await request.get(route).expect(200);
        expect(response.text).toContain(`data-route="${route}"`);
      }
    }
    await request.get("/v1/vms").expect(401);
    const list = await request.get("/v1/vms").set("Authorization", `Bearer ${KEY}`).expect(200);
    expect(list.body[0]).toMatchObject({ id: ID, name: "Fake VM",
      capabilities: { serial: false, display: false } });
    const crossOrigin = await request.get("/v1/vms")
      .set("Origin", "http://localhost:3000")
      .set("Authorization", `Bearer ${KEY}`).expect(200);
    expect(crossOrigin.headers["access-control-allow-origin"]).toBeUndefined();
    const detail = await request.get(`/v1/vms/${ID}`).set("Authorization", `Bearer ${KEY}`).expect(200);
    expect(detail.body).toMatchObject({ id: ID, capabilities: { serial: false, display: false } });
    expect((await request.get("/list_vms").set("Authorization", `Bearer ${KEY}`).expect(200)).body)
      .toEqual([{ UUID: ID, Name: "Fake VM", Status: "started" }]);
    expect((await request.get("/v1/unknown").set("Authorization", `Bearer ${KEY}`).expect(404)).body)
      .toEqual({ error: { code: "not_found", message: "Route not found" } });
    await request.get("/v1/unknown").expect(401);
    await request.get("/.git/config").expect(404);
    await request.get("/src/production.ts").expect(404);
  });

  it("uses only console upgrade paths and enforces the listener origin", async () => {
    const origin = `http://127.0.0.1:${port}`;
    const base = `ws://127.0.0.1:${port}`;
    const query = `?vmUUID=${ID}`;
    const serial = await unavailableConsole(`${base}/ws/serial${query}`, origin);
    expect(serial.messages.join(" ")).toContain("console unavailable");
    const vnc = await unavailableConsole(`${base}/ws/vnc${query}`, origin);
    expect(vnc.code).toBe(1011);
    expect(lookups).toEqual([`serial:${ID}`, `vnc:${ID}`]);
    expect(await upgradeStatus(`${base}/ws/other${query}`, origin)).toBe(404);
    expect(await upgradeStatus(`${base}/${query}`, origin)).toBe(404);
    expect(await upgradeStatus(`${base}/ws/serial${query}`, "http://other.example")).toBe(403);
    expect(await upgradeStatus(`${base}/ws/vnc${query}`)).toBe(403);
    expect(await upgradeStatus(`${base}/ws/vnc?vmUUID=${ID}`, origin, false)).toBe(401);
    expect(await upgradeStatus(`${base}/ws/vnc?vmUUID=invalid`, origin)).toBe(400);
    expect(lookups).toHaveLength(2);
  });
});
