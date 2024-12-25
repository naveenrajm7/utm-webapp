import { Request, Response } from "express";
import { exec } from "child_process";
import path from "path";

export const getVmInfo = (req: Request, res: Response) => {
  const { uuid } = req.query;

  if (!uuid) {
    return res.status(400).json({ status: "error", message: "UUID is required" });
  }

  const scriptPath = path.join(__dirname, "../scripts/get_vm_info.js");
  const command = `osascript -l JavaScript ${scriptPath} ${uuid}`;

  exec(command, (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({ status: "error", message: stderr });
    }

    try {
      const config = JSON.parse(stdout);
      return res.json(config);
    } catch (parseError) {
      return res.status(500).json({ status: "error", message: "Failed to parse VM config" });
    }
  });
};