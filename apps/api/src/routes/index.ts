import { Router, type Request, type Response } from "express";
import { isValidUuid } from "../utils/uuid";
import type { ApiPorts, PowerPort, UtmPort, Vm } from "../v1/ports";

/** Preserve the old field names while sourcing every value from the v1 VM port. */
const legacyVm = (vm: Vm, detail = false): Record<string, unknown> => {
  const result: Record<string, unknown> = {
    UUID: vm.id,
    Name: vm.name,
    Status: vm.status,
  };
  if (detail) {
    if (vm.architecture !== undefined) result.Architecture = vm.architecture;
    if (vm.machine !== undefined) result.Machine = vm.machine;
    if (vm.memoryMiB !== undefined) result.Memory = vm.memoryMiB;
    if (vm.serialPorts !== undefined) result.SerialPorts = vm.serialPorts;
    if (vm.drives !== undefined) result.Drives = vm.drives;
  }
  return result;
};

const legacyError = (res: Response, error: unknown): Response => {
  const candidate = error as { code?: unknown; message?: unknown } | null;
  const code = candidate?.code;
  const status = code === "not_found" ? 404
    : code === "conflict" ? 409
    : code === "unsupported" ? 422
    : code === "unavailable" || code === "service_unavailable" ? 503
    : 500;
  return res.status(status).json({
    status: "error",
    message: typeof candidate?.message === "string" && status !== 500
      ? candidate.message
      : "VM operation failed",
  });
};

const route = (handler: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response) => {
    void handler(req, res).catch(error => legacyError(res, error));
  };

const vmId = (req: Request, res: Response): string | undefined => {
  if (!isValidUuid(req.query.uuid)) {
    res.status(400).json({ status: "error", message: "A valid UUID is required" });
    return undefined;
  }
  return req.query.uuid;
};

export const createLegacyRouter = (ports: Partial<ApiPorts> = {}): Router => {
  const router = Router();
  const utm = (): UtmPort => {
    if (!ports.utm) throw { code: "service_unavailable", message: "Service is not configured" };
    return ports.utm;
  };
  const power = (): PowerPort => {
    const service = ports.power ?? ports.sandbox;
    if (!service) throw { code: "service_unavailable", message: "Service is not configured" };
    return service;
  };

  router.get("/list_vms", route(async (_req, res) =>
    res.json((await utm().listVms()).map(vm => legacyVm(vm)))));
  router.get("/vm_info", route(async (req, res) => {
    const id = vmId(req, res);
    if (id) res.json(legacyVm(await utm().getVm(id), true));
  }));
  router.get("/status_vm", route(async (req, res) => {
    const id = vmId(req, res);
    if (id) res.json({ status: "success", vmStatus: (await utm().getVm(id)).status });
  }));
  router.post("/start", route(async (req, res) => {
    const id = vmId(req, res);
    if (id) {
      const { jobId } = await power().startVm(id);
      res.status(202).json({ status: "success", jobId });
    }
  }));
  router.post("/stop", route(async (req, res) => {
    const id = vmId(req, res);
    if (id) {
      const { jobId } = await power().stopVm(id);
      res.status(202).json({ status: "success", jobId });
    }
  }));

  return router;
};
