import { Request, Response } from "express";
import { log } from "@repo/logger";
import { isValidUuid, runJxa } from "../utils/runJxa";

export const statusVm = async (req: Request, res: Response) => {
  const { uuid } = req.query;

  if (!isValidUuid(uuid)) {
    return res.status(400).json({ status: "error", message: "A valid UUID is required" });
  }

  try {
    const result = await runJxa("vm_control.js", ["status", uuid]);

    if (result.status === "error") {
      log(`Error getting status for ${uuid}: ${result.message}`);
      return res.status(500).json(result);
    }

    log(`VM ${uuid} status: ${result.vmStatus}`);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ status: "error", message: (error as Error).message });
  }
};
