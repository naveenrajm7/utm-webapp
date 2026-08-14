import { exec } from "child_process";
import path from "path";

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const isValidUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID_PATTERN.test(value);

export interface JxaResult {
  status: "success" | "error";
  message?: string;
  vmStatus?: string;
  address?: string;
  vncHost?: string;
  vncPort?: number;
}

/**
 * UTM's `utmctl` CLI cannot reach the UTM app from a non-GUI session (it fails
 * with OSStatus -600), so all VM control goes through AppleScript/JXA instead.
 */
export const runJxa = (script: string, args: string[] = []): Promise<JxaResult> => {
  const scriptPath = path.join(__dirname, "../scripts", script);
  const command = `osascript -l JavaScript ${scriptPath} ${args.join(" ")}`;

  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        return reject(new Error(stderr.trim() || error.message));
      }

      try {
        resolve(JSON.parse(stdout) as JxaResult);
      } catch {
        reject(new Error(`Unexpected script output: ${stdout.trim()}`));
      }
    });
  });
};
