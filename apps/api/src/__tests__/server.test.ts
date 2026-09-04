import { describe, it, expect, beforeEach } from "@jest/globals";
import http from "http";
import type { AddressInfo } from "net";
import supertest from "supertest";
import { WebSocket } from "ws";
import { createServer } from "../server";
import { attachWebSocketServer } from "../ws";

const TEST_KEY = "test-api-key";

describe("server", () => {
  beforeEach(() => {
    process.env.UTM_API_KEY = TEST_KEY;
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

  it("closes a WebSocket without a token", async () => {
    const server = http.createServer(createServer());
    attachWebSocketServer(server);

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
});
