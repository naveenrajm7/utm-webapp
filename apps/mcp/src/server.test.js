import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import readline from "node:readline";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ApiError, createApiClient } from "./api-client.js";

const entry = fileURLToPath(new URL("./index.js", import.meta.url));
const key = "fake-http-key";

async function fakeApi(respond) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const request = {
      method: req.method,
      path: req.url,
      authorization: req.headers.authorization,
      body: body ? JSON.parse(body) : undefined,
    };
    requests.push(request);
    const answer = respond(request);
    res.writeHead(answer.status ?? 200, { "content-type": "application/json" });
    res.end(JSON.stringify(answer.body));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function mcpClient(url) {
  const child = spawn(process.execPath, [entry], {
    env: { ...process.env, UTM_API_URL: url, UTM_API_KEY: key },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let nextId = 0;
  const pending = new Map();
  const lines = readline.createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    const reply = JSON.parse(line);
    const waiter = pending.get(reply.id);
    if (waiter) {
      pending.delete(reply.id);
      waiter.resolve(reply);
    }
  });
  child.on("exit", (code) => {
    for (const waiter of pending.values()) waiter.reject(new Error(`MCP process exited: ${code}`));
    pending.clear();
  });

  async function request(method, params) {
    const id = ++nextId;
    const reply = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    const answer = await reply;
    if (answer.error) throw new Error(JSON.stringify(answer.error));
    return answer.result;
  }
  await request("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "fake-http-test", version: "1.0.0" },
  });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  return {
    request,
    call: (name, args = {}) => request("tools/call", { name, arguments: args }),
    close: async () => {
      child.stdin.end();
      await once(child, "exit");
      lines.close();
    },
  };
}

test("all six stdio tools use the authenticated /v1 API", async () => {
  const responses = new Map([
    ["GET /v1/vms", [{ id: "vm1", name: "Test", capabilities: { guestExec: true } }]],
    ["GET /v1/templates", [{ id: "template1", name: "Disposable" }]],
    ["POST /v1/sandboxes", { sandboxId: "s1", jobId: "create1" }],
    ["POST /v1/sandboxes/s1/exec", { jobId: "exec1" }],
    ["GET /v1/jobs/exec1", { id: "exec1", state: "succeeded", result: { stdout: "ok\n", stderr: "", exitCode: 0 } }],
    ["DELETE /v1/sandboxes/s1", { jobId: "destroy1" }],
  ]);
  const api = await fakeApi(({ method, path }) => ({ body: responses.get(`${method} ${path}`) }));
  const mcp = await mcpClient(api.url);
  try {
    const listed = await mcp.request("tools/list", {});
    assert.deepEqual(listed.tools.map((tool) => tool.name), [
      "list_vms", "list_templates", "create_sandbox", "run_command", "get_job", "destroy_sandbox",
    ]);
    assert.deepEqual((await mcp.call("list_vms")).structuredContent.vms, responses.get("GET /v1/vms"));
    assert.deepEqual((await mcp.call("list_templates")).structuredContent.templates, responses.get("GET /v1/templates"));
    assert.deepEqual((await mcp.call("create_sandbox", {
      templateId: "template1", network: "offline", ttlSeconds: 600,
    })).structuredContent, { sandboxId: "s1", jobId: "create1" });
    assert.deepEqual((await mcp.call("run_command", {
      sandboxId: "s1", argv: ["/bin/echo", "ok"], timeoutSeconds: 20,
    })).structuredContent, { jobId: "exec1" });
    assert.deepEqual((await mcp.call("get_job", { jobId: "exec1" })).structuredContent,
      responses.get("GET /v1/jobs/exec1"));
    assert.deepEqual((await mcp.call("destroy_sandbox", { sandboxId: "s1" })).structuredContent,
      { jobId: "destroy1" });
    assert.equal(api.requests.length, 6);
    assert.ok(api.requests.every((request) => request.authorization === `Bearer ${key}`));
    assert.deepEqual(api.requests[2].body, { templateId: "template1", network: "offline", ttlSeconds: 600 });
    assert.deepEqual(api.requests[3].body, { argv: ["/bin/echo", "ok"], timeoutSeconds: 20 });
  } finally {
    await mcp.close();
    await api.close();
  }
});

test("capability and job failures remain structured", async () => {
  const job = { id: "failed1", state: "failed", error: { code: "guest_exec_failed", message: "Guest agent stopped" } };
  const api = await fakeApi(({ method, path }) => {
    if (method === "POST" && path.endsWith("/exec")) {
      return { status: 501, body: { error: { code: "unsupported", message: "Guest execution unavailable", details: { capability: "guestExec" } } } };
    }
    if (path === "/v1/jobs/failed1") return { body: job };
    return { status: 401, body: { error: "unauthorized" } };
  });
  const mcp = await mcpClient(api.url);
  try {
    const unsupported = await mcp.call("run_command", { sandboxId: "s/1", argv: ["id"] });
    assert.equal(unsupported.isError, true);
    assert.deepEqual(unsupported.structuredContent.error, {
      code: "unsupported", message: "Guest execution unavailable", status: 501,
      details: { capability: "guestExec" },
    });
    assert.equal(api.requests[0].path, "/v1/sandboxes/s%2F1/exec");
    const failed = await mcp.call("get_job", { jobId: "failed1" });
    assert.equal(failed.isError, true);
    assert.deepEqual(failed.structuredContent, job);
    const unauthorized = await mcp.call("list_vms");
    assert.equal(unauthorized.isError, true);
    assert.deepEqual(unauthorized.structuredContent.error, {
      code: "unauthorized", message: "API returned HTTP 401", status: 401,
    });
    const invalid = await mcp.call("create_sandbox", {
      templateId: "template1", network: "public", ttlSeconds: 600,
    });
    assert.equal(invalid.isError, true);
    assert.equal(api.requests.length, 3);
  } finally {
    await mcp.close();
    await api.close();
  }
});

test("configuration only permits an authenticated loopback API", () => {
  assert.throws(() => createApiClient({ apiKey: key, baseUrl: "http://example.com" }), ApiError);
  assert.throws(() => createApiClient({ apiKey: key, baseUrl: "https://localhost:3001" }), ApiError);
  assert.throws(() => createApiClient({ baseUrl: "http://127.0.0.1:3001" }), ApiError);
});
