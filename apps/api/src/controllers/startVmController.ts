import { Request, Response } from "express";
import { exec } from "child_process";

export const startVm = (req: Request, res: Response) => {
  const { uuid } = req.query;

  if (!uuid) {
    return res.status(400).json({ status: "error", message: "UUID is required" });
  }

  const command = `utmctl start ${uuid}`;

  exec(command, (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({ status: "error", message: stderr });
    }

    return res.json({ status: "success", message: stdout });
  });
};