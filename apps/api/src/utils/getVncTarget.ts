import { isValidUuid, runJxa } from "./runJxa";

export interface VncTarget {
  host: string;
  port: number;
}

export const getVncTarget = async (uuid: string): Promise<VncTarget> => {
  if (!isValidUuid(uuid)) {
    throw new Error("A valid UUID is required");
  }

  const result = await runJxa("vm_control.js", ["vnc", uuid]);

  if (result.status === "error" || !result.vncPort) {
    throw new Error(result.message || "VNC display not available");
  }

  return { host: result.vncHost || "127.0.0.1", port: result.vncPort };
};
