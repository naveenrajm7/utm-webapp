import { createServer } from "./server";
import { log } from "@repo/logger";
import http from "http";
import { assertApiKeyConfigured } from "./auth";
import { attachWebSocketServer } from "./ws";
import { UtmAdapter } from "@repo/utm-adapter";
import { LocalUtmPort } from "./v1/localUtmPort";
import { VmPowerJobs } from "./v1/vmPowerJobs";

assertApiKeyConfigured();

const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || "127.0.0.1";
const adapter = new UtmAdapter();
const app = createServer({ utm: new LocalUtmPort(adapter), power: new VmPowerJobs(adapter) });
const server = http.createServer(app);

attachWebSocketServer(server);

server.listen(port, host, () => {
  log(`api running on ${host}:${port}`);
});
