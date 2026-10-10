import { Router, type Request, type Response } from "express";
import { isValidUuid } from "../utils/runJxa";
import type { ApiPorts, SandboxPort, UtmPort } from "./ports";

type ErrorCode =
  | "invalid_input"
  | "not_found"
  | "unsupported"
  | "conflict"
  | "unauthorized"
  | "service_unavailable"
  | "internal";
const statusForCode: Record<ErrorCode, number> = {
  invalid_input: 400,
  not_found: 404,
  unsupported: 422,
  conflict: 409,
  unauthorized: 401,
  service_unavailable: 503,
  internal: 500,
};

export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const knownCodes = new Set<string>(Object.keys(statusForCode));
const sendError = (res: Response, error: unknown): Response => {
  const candidate = error as { code?: unknown; message?: unknown } | null;
  const code =
    typeof candidate?.code === "string" && knownCodes.has(candidate.code)
      ? (candidate.code as ErrorCode)
      : "internal";
  const message =
    code === "internal"
      ? "Internal server error"
      : typeof candidate?.message === "string" && candidate.message
        ? candidate.message
        : code;
  return res.status(statusForCode[code]).json({ error: { code, message } });
};

const route =
  (handler: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response) => {
    void handler(req, res).catch((error) => sendError(res, error));
  };

const requirePort = <T>(port: T | undefined): T => {
  if (!port)
    throw new ApiError("service_unavailable", "Service is not configured");
  return port;
};
const vmId = (value: unknown): string => {
  if (!isValidUuid(value))
    throw new ApiError("invalid_input", "A valid VM ID is required");
  return value;
};
const opaqueId = (value: unknown): string => {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)
  ) {
    throw new ApiError("invalid_input", "A valid ID is required");
  }
  return value;
};
const objectBody = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError("invalid_input", "A JSON object is required");
  }
  return value as Record<string, unknown>;
};
const hasOnly = (body: Record<string, unknown>, keys: string[]) => {
  if (Object.keys(body).some((key) => !keys.includes(key))) {
    throw new ApiError("invalid_input", "Unexpected request field");
  }
};
const boundedSeconds = (value: unknown, name: string, max: number): number => {
  if (
    !Number.isInteger(value) ||
    typeof value !== "number" ||
    value < 1 ||
    value > max
  ) {
    throw new ApiError(
      "invalid_input",
      `${name} must be an integer from 1 to ${max}`,
    );
  }
  return value;
};

export const createV1Router = (ports: Partial<ApiPorts> = {}): Router => {
  const router = Router();
  const utm = () => requirePort<UtmPort>(ports.utm);
  const sandbox = () => requirePort<SandboxPort>(ports.sandbox);

  router.get(
    "/capabilities",
    route(async (_req, res) => res.json(await utm().getCapabilities())),
  );
  router.get(
    "/vms",
    route(async (_req, res) => res.json(await utm().listVms())),
  );
  router.get(
    "/vms/:id",
    route(async (req, res) => {
      const id = vmId(req.params.id);
      res.json(await utm().getVm(id));
    }),
  );
  router.post(
    "/vms/:id/start",
    route(async (req, res) => {
      const id = vmId(req.params.id);
      hasOnly(objectBody(req.body), []);
      res.status(202).json(await sandbox().startVm(id));
    }),
  );
  router.post(
    "/vms/:id/stop",
    route(async (req, res) => {
      const id = vmId(req.params.id);
      hasOnly(objectBody(req.body), []);
      res.status(202).json(await sandbox().stopVm(id));
    }),
  );
  router.get(
    "/templates",
    route(async (_req, res) => res.json(await sandbox().listTemplates())),
  );
  router.post(
    "/sandboxes",
    route(async (req, res) => {
      const body = objectBody(req.body);
      hasOnly(body, ["templateId", "network", "ttlSeconds"]);
      const templateId = vmId(body.templateId);
      if (body.network !== "offline" && body.network !== "shared") {
        throw new ApiError(
          "invalid_input",
          "network must be offline or shared",
        );
      }
      const ttlSeconds = boundedSeconds(body.ttlSeconds, "ttlSeconds", 604800);
      res
        .status(202)
        .json(
          await sandbox().createSandbox({
            templateId,
            network: body.network,
            ttlSeconds,
          }),
        );
    }),
  );
  router.get(
    "/sandboxes/:id",
    route(async (req, res) => {
      const id = opaqueId(req.params.id);
      res.json(await sandbox().getSandbox(id));
    }),
  );
  router.post(
    "/sandboxes/:id/exec",
    route(async (req, res) => {
      const id = opaqueId(req.params.id);
      const body = objectBody(req.body);
      hasOnly(body, ["argv", "timeoutSeconds"]);
      if (
        !Array.isArray(body.argv) ||
        body.argv.length < 1 ||
        body.argv.length > 128 ||
        body.argv.some(
          (arg) =>
            typeof arg !== "string" ||
            !arg.length ||
            arg.length > 4096 ||
            arg.includes("\0"),
        )
      ) {
        throw new ApiError(
          "invalid_input",
          "argv must contain 1 to 128 nonempty strings",
        );
      }
      const argv = body.argv as string[];
      const timeoutSeconds =
        body.timeoutSeconds === undefined
          ? undefined
          : boundedSeconds(body.timeoutSeconds, "timeoutSeconds", 3600);
      res
        .status(202)
        .json(await sandbox().execSandbox(id, { argv, timeoutSeconds }));
    }),
  );
  router.delete(
    "/sandboxes/:id",
    route(async (req, res) => {
      const id = opaqueId(req.params.id);
      res.status(202).json(await sandbox().destroySandbox(id));
    }),
  );
  router.get(
    "/jobs/:id",
    route(async (req, res) => {
      const id = opaqueId(req.params.id);
      res.json(await sandbox().getJob(id));
    }),
  );
  router.use((_req, res) =>
    sendError(res, new ApiError("not_found", "Route not found")),
  );
  return router;
};
