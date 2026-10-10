import { Request, Response } from "express";
import { isValidUuid } from "../utils/runJxa";
import { getLegacyVmInfo } from "../services/legacyVmService";

export const getVmInfo = async (req: Request, res: Response) => {
  const { uuid } = req.query;

  if (!isValidUuid(uuid)) {
    return res
      .status(400)
      .json({ status: "error", message: "A valid UUID is required" });
  }

  try {
    const result = await getLegacyVmInfo(uuid);
    if (result.status === "error") {
      return res.status(404).json(result);
    }
    return res.json(result);
  } catch {
    return res
      .status(500)
      .json({ status: "error", message: "Failed to get VM config" });
  }
};
