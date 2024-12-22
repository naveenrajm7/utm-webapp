import { Request, Response } from "express";
import { exec } from "child_process";
import path from "path";

export const listVMs = (_: Request, res: Response) => {
  const scriptPath = path.join(__dirname, "../scripts/list_vm.js");
  exec(`osascript -l JavaScript ${scriptPath}`, (error, stdout, stderr) => {
    if (error) {
      console.error(`exec error: ${error}`);
      return res.status(500).json({ error: "Failed to execute script" });
    }
    if (stderr) {
      console.error(`stderr: ${stderr}`);
      return res.status(500).json({ error: stderr });
    }
    try {
      const result = JSON.parse(stdout);
      return res.json(result);
    } catch (parseError) {
      console.error(`parse error: ${parseError}`);
      return res.status(500).json({ error: "Failed to parse script output" });
    }
  });
};