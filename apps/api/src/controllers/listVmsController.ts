import { Request, Response } from "express";
import { listLegacyVms } from "../services/legacyVmService";

export const listVMs = async (_: Request, res: Response) => {
  try {
    return res.json(await listLegacyVms());
  } catch {
    return res.status(500).json({ error: "Failed to list VMs" });
  }
};
