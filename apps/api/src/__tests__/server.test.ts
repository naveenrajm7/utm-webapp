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
    process.env.UTM_WEB_ORIGIN = "http://localhost:3000";
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

  it("allows CORS only for the configured local web origin", async () => {
    const request = supertest(createServer());
    const allowed = await request.options("/v1/vms")
      .set("Origin", "http://localhost:3000")
      .set("Access-Control-Request-Method", "GET");
    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    const denied = await request.options("/v1/vms")
      .set("Origin", "http://other.example")
      .set("Access-Control-Request-Method", "GET");
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
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
          `ws://127.0.0.1:${port}${path}&token=${TEST_KEY}`,
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

  it("rejects a WebSocket from an unconfigured browser origin", async () => {
    const server = http.createServer(createServer());
    attachWebSocketServer(server, {
      getSerialDevice: async () => { throw new Error("resolver must not run"); },
      getVncTarget: async () => { throw new Error("resolver must not run"); },
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/?vmUUID=${VM_ID}&token=${TEST_KEY}`, {
        origin: "http://other.example",
      });
      expect(await closed(ws)).toBe(1008);
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
      const serial = new WebSocket(`ws://127.0.0.1:${port}/?vmUUID=${VM_ID}&token=${TEST_KEY}`, {
        origin: "http://localhost:3000",
      });
      const messages: string[] = [];
      serial.on("message", data => messages.push(data.toString()));
      await closed(serial);
      expect(messages.join(" ")).toContain("no serial port");

      const vnc = new WebSocket(`ws://127.0.0.1:${port}/vnc?vmUUID=${VM_ID}&token=${TEST_KEY}`, {
        origin: "http://localhost:3000",
      });
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
      const ws = new WebSocket(`ws://127.0.0.1:${port}/vnc?vmUUID=${VM_ID}&token=${TEST_KEY}`, {
        origin: "http://localhost:3000",
      });
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
      const ws = new WebSocket(`ws://127.0.0.1:${port}/vnc?vmUUID=${VM_ID}&token=${TEST_KEY}`, {
        origin: "http://localhost:3000",
      });
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
