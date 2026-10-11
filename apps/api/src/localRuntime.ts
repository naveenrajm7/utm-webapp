import http from "node:http";
import type { UtmPort as AdapterPort } from "@repo/utm-adapter";
import { createServer } from "./server";
import { LocalUtmPort } from "./v1/localUtmPort";
import { VmPowerJobs } from "./v1/vmPowerJobs";
import { attachWebSocketServer } from "./ws";

type LocalAdapter = Pick<AdapterPort,
  "getCapabilities" | "listVms" | "getVm" | "startVm" | "stopVm" |
  "getSerialDevice" | "getVncTarget">;

/** Use one adapter instance for REST inventory, power jobs, and consoles. */
export const createLocalRuntime = (adapter: LocalAdapter): http.Server => {
  const app = createServer({
    utm: new LocalUtmPort(adapter),
    power: new VmPowerJobs(adapter),
  });
  const server = http.createServer(app);
  attachWebSocketServer(server, adapter);
  return server;
};
