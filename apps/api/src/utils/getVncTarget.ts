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

  if (
    result.status === "error" ||
    !Number.isInteger(result.vncPort) ||
    result.vncPort! < 1 ||
    result.vncPort! > 65535
  ) {
    throw new Error(result.message || "VNC display not available");
  }

  const host = result.vncHost || "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error("VNC display must be on loopback");
  }
  return { host, port: result.vncPort! };
};
