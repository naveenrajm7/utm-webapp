import { describe, it, expect, beforeEach } from "@jest/globals";
import http from "http";
import net from "net";
import type { AddressInfo } from "net";
import supertest from "supertest";
import { WebSocket } from "ws";
import { createServer } from "../server";
import { attachWebSocketServer } from "../ws";
import { configuredApiHost } from "../webOrigin";

const TEST_KEY = "test-api-key";
const VM_ID = "12345678-1234-1234-1234-123456789abc";
const wsAuth = (binary = false) => ["utm-auth", `utm-auth.${Buffer.from(TEST_KEY).toString("base64url")}`,
  ...(binary ? ["binary"] : [])];
const unusedConsole = {
  getSerialDevice: async () => { throw new Error("Unexpected serial lookup"); },
  getVncTarget: async () => { throw new Error("Unexpected VNC lookup"); },
};

const closed = (ws: WebSocket): Promise<number> => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("WebSocket did not close")), 5000);
  ws.on("close", code => { clearTimeout(timer); resolve(code); });
  ws.on("error", reject);
});

describe("server", () => {
  beforeEach(() => {
    process.env.UTM_API_KEY = TEST_KEY;
    delete process.env.UTM_WEB_ORIGIN;
  });

  it("status check returns 200 without a key", async () => {
    await supertest(createServer())
      .get("/status")
      .expect(200)
      .then((res) => {
        expect(res.body.ok).toBe(true);
      });
  });

  it("message endpoint says hello with a valid key", async () => {
    await supertest(createServer())
      .get("/message/jared")
      .set("Authorization", `Bearer ${TEST_KEY}`)
      .expect(200)
      .then((res) => {
        expect(res.body.message).toBe("hello jared");
      });
  });

  it("list_vms returns 401 without a key", async () => {
    await supertest(createServer())
      .get("/list_vms")
      .expect(401)
      .then((res) => {
        expect(res.body.error).toBe("unauthorized");
      });
  });

  it("list_vms returns 401 with a bad key", async () => {
    await supertest(createServer())
      .get("/list_vms")
      .set("Authorization", "Bearer wrong-key")
      .expect(401)
      .then((res) => {
        expect(res.body.error).toBe("unauthorized");
      });
  });

  it("list_vms does not return 401 with a valid key", async () => {
    const res = await supertest(createServer())
      .get("/list_vms")
      .set("Authorization", `Bearer ${TEST_KEY}`);

    expect(res.status).not.toBe(401);
  });

  it("POST /start returns 401 without a key", async () => {
    await supertest(createServer())
      .post("/start?uuid=00000000-0000-0000-0000-000000000000")
      .expect(401);
  });

  it("GET /start is not available", async () => {
    await supertest(createServer())
      .get("/start?uuid=00000000-0000-0000-0000-000000000000")
      .set("Authorization", `Bearer ${TEST_KEY}`)
      .expect(404);
  });

  it("allows authenticated browser requests and preflight from both default origins", async () => {
    const request = supertest(createServer({ utm: {
      getCapabilities: async () => ({ utmVersion: "5.0.6", features: {} }),
      listVms: async () => [],
      getVm: async () => { throw new Error("unused"); },
    } }));
    for (const origin of ["http://localhost:3000", "http://127.0.0.1:3000"]) {
      const allowed = await request.options("/v1/vms")
        .set("Origin", origin)
        .set("Access-Control-Request-Method", "GET")
        .set("Access-Control-Request-Headers", "authorization").expect(204);
      expect(allowed.headers["access-control-allow-origin"]).toBe(origin);
      expect(allowed.headers["access-control-allow-headers"]).toContain("authorization");
      const unauthorized = await request.get("/v1/vms").set("Origin", origin).expect(401);
      expect(unauthorized.headers["access-control-allow-origin"]).toBe(origin);
      const authorized = await request.get("/v1/vms").set("Origin", origin)
        .set("Authorization", `Bearer ${TEST_KEY}`).expect(200);
      expect(authorized.headers["access-control-allow-origin"]).toBe(origin);
      expect(authorized.body).toEqual([]);
    }
    const denied = await request.options("/v1/vms")
      .set("Origin", "http://other.example")
      .set("Access-Control-Request-Method", "GET");
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("readiness checks the UTM inventory and journal while liveness stays independent", async () => {
    let journalOwned = true;
    let inventoryWorks = true;
    const app = createServer({
      utm: {
        getCapabilities: async () => ({ utmVersion: "5.0.6", features: {} }),
        listVms: async () => {
          if (!inventoryWorks) throw new Error("/private/local/utm.jxa.js raw output");
          return [];
        },
        getVm: async () => { throw new Error("unused"); },
      },
      readiness: () => journalOwned,
    });
    const request = supertest(app);
    expect((await request.get("/ready").expect(200)).body).toEqual({ ready: true });
    inventoryWorks = false;
    expect((await request.get("/ready").expect(503)).body).toEqual({ ready: false });
    inventoryWorks = true;
    journalOwned = false;
    expect((await request.get("/ready").expect(503)).body).toEqual({ ready: false });
    expect((await request.get("/status").expect(200)).body).toEqual({ ok: true });
  });

  it("returns a stable legacy error for malformed JSON", async () => {
    const response = await supertest(createServer()).post("/start?uuid=" + VM_ID)
      .set("Authorization", `Bearer ${TEST_KEY}`)
      .set("Content-Type", "application/json")
      .send("{broken").expect(400);
    expect(response.body).toEqual({ status: "error", message: "Invalid request body" });
  });

  it("refuses a non-loopback API host", () => {
    const previous = process.env.HOST;
    try {
      process.env.HOST = "0.0.0.0";
      expect(configuredApiHost).toThrow("HOST must be a loopback address");
    } finally {
      if (previous === undefined) delete process.env.HOST;
      else process.env.HOST = previous;
    }
  });

  it("refuses a non-local configured web origin", () => {
    const previous = process.env.UTM_WEB_ORIGIN;
    try {
      process.env.UTM_WEB_ORIGIN = "https://other.example";
      expect(createServer).toThrow("UTM_WEB_ORIGIN must be a local HTTP origin");
    } finally {
      if (previous === undefined) delete process.env.UTM_WEB_ORIGIN;
      else process.env.UTM_WEB_ORIGIN = previous;
    }
  });

  it("an explicit local origin narrows browser access", async () => {
    process.env.UTM_WEB_ORIGIN = "http://localhost:3000";
    const response = await supertest(createServer()).options("/v1/vms")
      .set("Origin", "http://127.0.0.1:3000")
      .set("Access-Control-Request-Method", "GET");
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("closes a WebSocket without a token", async () => {
    const server = http.createServer(createServer());
    attachWebSocketServer(server, unusedConsole);

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });

    const { port } = server.address() as AddressInfo;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/?vmUUID=test`);

    try {
      const code = await new Promise<number>((resolve, reject) => {
        ws.on("close", (closeCode) => resolve(closeCode));
        ws.on("error", () => {
          // The client may emit an error around the unauthorized close.
        });
        setTimeout(() => reject(new Error("WebSocket did not close")), 5000);
      });

      expect(code).toBe(1008);
    } finally {
      ws.close();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("rejects unknown WebSocket paths and invalid VM IDs", async () => {
    const server = http.createServer(createServer());
    attachWebSocketServer(server, unusedConsole);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const { port } = server.address() as AddressInfo;
    try {
      for (const path of [
        "/unexpected?vmUUID=12345678-1234-1234-1234-123456789abc",
        "/?vmUUID=not-a-uuid",
        "/vnc?vmUUID=12345678-1234-1234-1234-123456789abc&extra=1",
      ]) {
        const ws = new WebSocket(
          `ws://127.0.0.1:${port}${path}`,
        );
        const code = await new Promise<number>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("WebSocket did not close")),
            5000,
          );
          ws.on("close", (closeCode) => {
            clearTimeout(timer);
            resolve(closeCode);
          });
          ws.on("error", reject);
        });
        expect(code).toBe(1008);
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("accepts both default WebSocket origins and rejects other origins", async () => {
    const server = http.createServer(createServer());
    const calls: string[] = [];
    attachWebSocketServer(server, {
      getSerialDevice: async () => { calls.push("serial"); throw new Error("/private/local/utm.jxa.js raw output"); },
      getVncTarget: async () => { throw new Error("resolver must not run"); },
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      for (const origin of ["http://localhost:3000", "http://127.0.0.1:3000"]) {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/?vmUUID=${VM_ID}`, wsAuth(), { origin });
        const messages: string[] = [];
        ws.on("message", data => messages.push(data.toString()));
        await closed(ws);
        expect(messages.join(" ")).toContain("console unavailable");
        expect(messages.join(" ")).not.toContain("/private/");
      }
      const ws = new WebSocket(`ws://127.0.0.1:${port}/?vmUUID=${VM_ID}`, wsAuth(), { origin: "http://other.example" });
      expect(await closed(ws)).toBe(1008);
      expect(calls).toHaveLength(2);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it("closes unavailable serial and VNC consoles through the injected resolver", async () => {
    const server = http.createServer(createServer());
    const calls: string[] = [];
    attachWebSocketServer(server, {
      getSerialDevice: async id => { calls.push(`serial:${id}`); throw new Error("no serial port"); },
      getVncTarget: async id => { calls.push(`vnc:${id}`); throw new Error("no VNC target"); },
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const serial = new WebSocket(`ws://127.0.0.1:${port}/?vmUUID=${VM_ID}`, wsAuth(), { origin: "http://localhost:3000" });
      const messages: string[] = [];
      serial.on("message", data => messages.push(data.toString()));
      await closed(serial);
      expect(messages.join(" ")).toContain("console unavailable");

      const vnc = new WebSocket(`ws://127.0.0.1:${port}/vnc?vmUUID=${VM_ID}`, wsAuth(true), { origin: "http://localhost:3000" });
      expect(await closed(vnc)).toBe(1011);
      expect(calls).toEqual([`serial:${VM_ID}`, `vnc:${VM_ID}`]);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it("refuses a non-loopback VNC target from a resolver", async () => {
    const server = http.createServer(createServer());
    attachWebSocketServer(server, {
      getSerialDevice: async () => { throw new Error("unused"); },
      getVncTarget: async () => ({ host: "192.0.2.1", port: 5900 }),
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/vnc?vmUUID=${VM_ID}`, wsAuth(true), { origin: "http://localhost:3000" });
      expect(await closed(ws)).toBe(1011);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it("accepts binary VNC input and rejects text input", async () => {
    const tcp = net.createServer();
    const received: Buffer[] = [];
    tcp.on("connection", socket => socket.on("data", chunk => received.push(chunk)));
    await new Promise<void>(resolve => tcp.listen(0, "127.0.0.1", resolve));
    const tcpPort = (tcp.address() as AddressInfo).port;
    const server = http.createServer(createServer());
    attachWebSocketServer(server, {
      getSerialDevice: async () => { throw new Error("unused"); },
      getVncTarget: async () => ({ host: "127.0.0.1", port: tcpPort }),
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/vnc?vmUUID=${VM_ID}`, wsAuth(true), { origin: "http://localhost:3000" });
      await new Promise<void>(resolve => ws.on("open", resolve));
      ws.send(Buffer.from([1, 2, 3]));
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("VNC bytes not forwarded")), 5000);
        const check = () => {
          if (received.length) { clearTimeout(timer); resolve(); }
          else setTimeout(check, 5);
        };
        check();
      });
      expect(Buffer.concat(received)).toEqual(Buffer.from([1, 2, 3]));
      const close = closed(ws);
      ws.send("text is not VNC");
      expect(await close).toBe(1008);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
      await new Promise<void>(resolve => tcp.close(() => resolve()));
    }
  });
});
