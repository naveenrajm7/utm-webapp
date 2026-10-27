import { json, urlencoded } from "body-parser";
import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import morgan from "morgan";
import type { AdminAuth } from "./adminAuth";
import { createAuthRouter, trustedHost, trustedOrigin } from "./authRoutes";
import cors from "cors";
import { isAuthorizedRequest, requireApiKey } from "./auth";
import { createLegacyRouter } from "./routes";
import { createV1Router } from "./v1/routes";
import type { ApiPorts } from "./v1/ports";
import { configuredWebOrigins, isAllowedWebOrigin } from "./webOrigin";

export const createServer = (
  ports: Partial<ApiPorts> = {},
  options: { singleOrigin?: boolean; auth?: AdminAuth } = {},
): Express => {
  const app = express();
  if (!options.singleOrigin) configuredWebOrigins();
  const authorize = (req: Request, res: Response, next: NextFunction) => {
    res.set("Cache-Control", "no-store");
    if (!options.auth) {
      if (req.path.startsWith("/v1")) {
        if (!isAuthorizedRequest(req)) return res.status(401).json({ error: { code: "unauthorized", message: "Unauthorized" } });
        return next();
      }
      return requireApiKey(req, res, next);
    }
    if (!trustedHost(req)) return res.status(403).json({ error: { code: "forbidden", message: "Invalid host" } });
    const session = options.auth.session(req);
    if (!session) return res.status(401).json({ error: { code: "unauthorized", message: "Please log in" } });
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      (!trustedOrigin(req, Boolean(options.singleOrigin)) || req.get("X-UTM-CSRF") !== session.csrf))
      return res.status(403).json({ error: { code: "forbidden", message: "Invalid session request" } });
    return next();
  };
  app
    .disable("x-powered-by")
    .use(morgan("dev"))
    .use(cors({ credentials: true, origin: options.singleOrigin
      ? false
      : (origin, callback) => callback(null, isAllowedWebOrigin(origin)) }))
    .use("/auth", createAuthRouter(options.auth, Boolean(options.singleOrigin)))
    .use((req, res, next) => req.path === "/status" || req.path === "/ready" ? next() : authorize(req, res, next))
    .use(urlencoded({ extended: true }))
    .use(json())
    .use((error: unknown, req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith("/v1/") || req.path === "/v1") {
        return res
          .status(400)
          .json({
            error: { code: "invalid_input", message: "Invalid request body" },
          });
      }
      return next(error);
    })
    .get("/status", (_, res) => {
      return res.json({ ok: true });
    })
    .get("/ready", async (_req, res) => {
      try {
        if (!ports.utm || (ports.readiness && !await ports.readiness()))
          throw new Error("API services are unavailable");
        await ports.utm.listVms();
        return res.json({ ready: true });
      } catch {
        return res.status(503).json({ ready: false });
      }
    })
    .use("/v1", createV1Router(ports))
    .get("/message/:name", (req, res) => {
      return res.json({ message: `hello ${req.params.name}` });
    })
    .use(createLegacyRouter(ports))
    .use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
      const badBody = (error as { status?: unknown } | null)?.status === 400;
      if (req.path.startsWith("/v1/") || req.path === "/v1") {
        return res.status(badBody ? 400 : 500).json({ error: badBody
          ? { code: "invalid_input", message: "Invalid request body" }
          : { code: "internal", message: "Internal server error" } });
      }
      return res.status(badBody ? 400 : 500).json({
        status: "error", message: badBody ? "Invalid request body" : "VM operation failed",
      });
    });

  return app;
};
