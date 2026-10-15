import { createServer } from "node:http";
import { createHash } from "node:crypto";

export const SOURCE_ID = "10EC4AB2-91F6-42AB-A3DF-0996C75B80CF";
export const CLONE_ID = "D6D4522A-8AD8-439A-AF16-5E30C567F09C";
export const API_KEY = "browser-acceptance-key";

const source = () => ({
  id: SOURCE_ID, name: "Acceptance Source", status: "stopped", backend: "qemu",
  memoryMiB: 4096, cpuCores: 2, serialPorts: [{ name: "serial0" }],
  capabilities: {
    start: true, stop: true, clone: true, configure: true, delete: true,
    serial: true, display: true,
  },
});

export class FakeApi {
  constructor(port = Number(process.env.BROWSER_API_PORT || 3001), webPort = Number(process.env.BROWSER_WEB_PORT || 3000)) {
    this.port = port;
    this.webOrigin = `http://127.0.0.1:${webPort}`;
    this.reset();
  }

  reset() {
    for (const socket of this.serialSockets || []) socket.destroy();
    for (const socket of this.vncSockets || []) socket.destroy();
    this.vms = new Map([[SOURCE_ID, source()]]);
    this.jobs = new Map();
    this.jobFailures = new Map();
    this.nextJobPollFails = false;
    this.mutations = [];
    this.requests = [];
    this.sequence = 0;
    this.serialSockets = new Set();
    this.vncSockets = new Set();
    this.upgrades = [];
  }

  async start() {
    this.server = createServer((request, response) => void this.handle(request, response));
    this.server.on("upgrade", (request, socket) => this.upgrade(request, socket));
    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.port, "127.0.0.1", resolve);
    });
  }

  async close() {
    this.closeSerial();
    for (const socket of this.vncSockets) socket.destroy();
    this.vncSockets.clear();
    if (this.server) await new Promise((resolve) => this.server.close(resolve));
  }

  closeSerial() {
    for (const socket of this.serialSockets) socket.destroy();
    this.serialSockets.clear();
  }

  failNextAcceptedJobPoll() {
    this.nextJobPollFails = true;
  }

  upgrade(request, socket) {
    const url = new URL(request.url, `http://127.0.0.1:${this.port}`);
    const kind = ["/", "/ws/serial"].includes(url.pathname) ? "serial"
      : ["/vnc", "/ws/vnc"].includes(url.pathname) ? "vnc" : null;
    if (!kind || url.searchParams.get("token") !== API_KEY ||
        !this.vms.has(url.searchParams.get("vmUUID"))) return socket.destroy();
    const accept = createHash("sha1")
      .update(request.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
      .digest("base64");
    socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const sockets = kind === "vnc" ? this.vncSockets : this.serialSockets;
    this.upgrades.push({ kind, path: url.pathname, host: request.headers.host, origin: request.headers.origin });
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  }

  finish(jobId, state = "succeeded") {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Unknown fake job ${jobId}`);
    job.state = state;
    if (state === "unknown") {
      job.error = { code: "outcome_unknown", message: "Inspect refreshed VM state." };
      return;
    }
    if (state !== "succeeded") throw new Error(`Unsupported fake outcome ${state}`);
    const { vmId, action, body } = job.operation;
    const vm = this.vms.get(vmId);
    if (action === "clone") {
      this.vms.set(CLONE_ID, { ...vm, id: CLONE_ID, name: body.name, status: "stopped" });
      job.result = { vmId: CLONE_ID };
    } else if (action === "configure") {
      this.vms.set(vmId, { ...vm, ...body });
      job.result = { vmId, status: vm.status };
    } else if (action === "delete") {
      this.vms.delete(vmId);
      job.result = { vmId, deleted: true };
    } else {
      const status = action === "start" ? "running" : "stopped";
      this.vms.set(vmId, { ...vm, status });
      job.result = { vmId, status };
    }
  }

  async handle(request, response) {
    const origin = request.headers.origin;
    if (origin === this.webOrigin) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
      response.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    }
    response.setHeader("Content-Type", "application/json");
    if (request.method === "OPTIONS") return this.reply(response, 204);
    const path = new URL(request.url, `http://127.0.0.1:${this.port}`).pathname;
    this.requests.push({ method: request.method, path, auth: request.headers.authorization });
    if (request.headers.authorization !== `Bearer ${API_KEY}`)
      return this.reply(response, 401, { error: { code: "unauthorized", message: "Invalid API key" } });
    if (request.method === "GET" && path === "/v1/vms")
      return this.reply(response, 200, [...this.vms.values()].map((vm) => ({ ...vm })));
    const vmMatch = /^\/v1\/vms\/([^/]+)(?:\/(start|stop|clone))?$/.exec(path);
    if (vmMatch) {
      const vmId = decodeURIComponent(vmMatch[1]);
      const vm = this.vms.get(vmId);
      if (!vm) return this.reply(response, 404, { error: { code: "not_found", message: "VM not found" } });
      if (request.method === "GET" && !vmMatch[2]) return this.reply(response, 200, vm);
      const action = vmMatch[2] || (request.method === "PATCH" ? "configure" : "delete");
      if (!(["start", "stop", "clone"].includes(action) && request.method === "POST") &&
          !(action === "configure" && request.method === "PATCH") &&
          !(action === "delete" && request.method === "DELETE"))
        return this.reply(response, 405, { error: { code: "method_not_allowed" } });
      const body = await this.readBody(request);
      if (action === "delete" && body.confirmName !== vm.name)
        return this.reply(response, 409, { error: { code: "conflict", message: "Confirmation must match the current VM name" } });
      const jobId = `acceptance-job-${++this.sequence}`;
      if (this.nextJobPollFails) {
        this.jobFailures.set(jobId, 1);
        this.nextJobPollFails = false;
      }
      this.mutations.push({ method: request.method, path, body, jobId });
      this.jobs.set(jobId, { id: jobId, state: "running", operation: { vmId, action, body } });
      return this.reply(response, 202, { jobId });
    }
    const jobMatch = /^\/v1\/jobs\/([^/]+)$/.exec(path);
    if (request.method === "GET" && jobMatch) {
      const jobId = decodeURIComponent(jobMatch[1]);
      const failures = this.jobFailures.get(jobId) || 0;
      if (failures > 0) {
        this.jobFailures.set(jobId, failures - 1);
        return this.reply(response, 503, { error: { code: "service_unavailable", message: "Temporary fake outage" } });
      }
      const job = this.jobs.get(jobId);
      return job
        ? this.reply(response, 200, { id: job.id, state: job.state, result: job.result, error: job.error })
        : this.reply(response, 404, { error: { code: "not_found", message: "Job not found" } });
    }
    return this.reply(response, 404, { error: { code: "not_found", message: "Not found" } });
  }

  async readBody(request) {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    return raw ? JSON.parse(raw) : {};
  }

  reply(response, status, data) {
    response.writeHead(status);
    response.end(data === undefined ? "" : JSON.stringify(data));
  }
}
