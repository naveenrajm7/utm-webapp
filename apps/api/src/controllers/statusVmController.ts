import { Request, Response } from "express";
import { exec } from "child_process";
import { log } from "@repo/logger";

export const statusVm = (req: Request, res: Response) => {
  const { uuid } = req.query;

  if (!uuid) {
    return res.status(400).json({ status: "error", message: "UUID is required" });
  }

  const command = `utmctl status ${uuid}`;

  exec(command, (error, stdout, stderr) => {
    if (error) {
      log(`Error executing command: ${stderr}`);
      return res.status(500).json({ status: "error", message: stderr });
    }

    // Log the output of the command
    log(`Command output: ${stdout}`);

    // Check the output and determine the status
    const output = stdout.toLowerCase();
    let vmStatus = "unknown";

    if (output.includes("started")) {
      vmStatus = "started";
    } else if (output.includes("stopped")) {
      vmStatus = "stopped";
    }

    // Log the determined status
    log(`Determined VM status: ${vmStatus}`);

    return res.json({ status: "success", vmStatus });
  });
};