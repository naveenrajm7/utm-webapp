import { Request, Response } from "express";
import { isValidUuid, runJxa } from "../utils/runJxa";

export const startVm = async (req: Request, res: Response) => {
  const { uuid } = req.query;

  if (!isValidUuid(uuid)) {
    return res.status(400).json({ status: "error", message: "A valid UUID is required" });
  }

  try {
    const result = await runJxa("vm_control.js", ["start", uuid]);

    if (result.status === "error") {
      return res.status(500).json(result);
    }

    return res.json(result);
  } catch (error) {
    return res.status(500).json({ status: "error", message: (error as Error).message });
  }
};
