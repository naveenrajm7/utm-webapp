import { AdminAuth } from "./adminAuth";
import { assertApiKeyConfigured } from "./auth";
import { log } from "@repo/logger";
import http, { type RequestListener } from "node:http";
import type { UtmPort as AdapterPort } from "@repo/utm-adapter";
import { createServer } from "./server";
import { LocalUtmPort } from "./v1/localUtmPort";
import { VmPowerJobs } from "./v1/vmPowerJobs";
import { attachWebSocketServer } from "./ws";

type LocalAdapter = Pick<AdapterPort,
  "getCapabilities" | "listVms" | "getVm" | "startVm" | "stopVm" |
  "cloneVm" | "configureVm" | "deleteVm" | "getSerialDevice" | "getVncTarget">;

/** Use one adapter instance for REST inventory, power jobs, and consoles. */
const API_PATHS = new Set([
  "/status", "/ready", "/list_vms", "/vm_info", "/status_vm", "/start", "/stop",
]);

const isApiPath = (rawUrl: string | undefined): boolean => {
  const path = rawUrl?.split("?", 1)[0] || "/";
  return path === "/auth" || path.startsWith("/auth/") || path === "/v1" || path.startsWith("/v1/") ||
    path.startsWith("/message/") || API_PATHS.has(path);
};

export interface LocalRuntimeOptions {
  webHandler?: RequestListener;
  singleOrigin?: boolean;
  /** Inject isolated auth storage for tests; runtime owns its lifetime. */
  auth?: AdminAuth;
}

export type InjectableAdapter = LocalAdapter;

export const createLocalRuntime = (
  adapter: LocalAdapter,
  options: LocalRuntimeOptions = {},
): http.Server => {
  const mode = process.env.UTM_AUTH_MODE || "session";
  if (!["session", "api-key"].includes(mode)) throw new Error("UTM_AUTH_MODE must be session or api-key");
  if (mode === "api-key" && !options.auth) assertApiKeyConfigured();
  const auth = options.auth || (mode === "session" ? new AdminAuth() : undefined);
  let operations: VmPowerJobs | undefined;
  try {
    operations = new VmPowerJobs(adapter);
    if (auth && !auth.configured) log(`UTM Web initial setup code: ${auth.setupCode}`);
    const app = createServer({
      utm: new LocalUtmPort(adapter),
      power: operations,
      management: operations,
      readiness: () => operations!.isReady(),
    }, { singleOrigin: options.singleOrigin, auth });
    const server = http.createServer((req, res) => {
      if (options.webHandler && !isApiPath(req.url)) {
        try {
          void Promise.resolve(options.webHandler(req, res)).catch(() => {
            if (!res.headersSent) res.statusCode = 500;
            if (!res.writableEnded) res.end();
          });
        } catch {
          if (!res.headersSent) res.statusCode = 500;
          if (!res.writableEnded) res.end();
        }
        return;
      }
      app(req, res);
    });
    const release = () => { operations?.close(); auth?.close(); };
    process.on("exit", release);
    server.on("close", () => {
      process.removeListener("exit", release);
      release();
    });
    attachWebSocketServer(server, adapter,
      options.singleOrigin ? "single-origin" : "development", auth);
    return server;
  } catch (error) {
    operations?.close();
    auth?.close();
    throw error;
  }
};
