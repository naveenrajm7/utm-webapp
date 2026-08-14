import { isValidUuid, runJxa } from "./runJxa";

export const getPtyDevice = async (uuid: string): Promise<string> => {
  if (!isValidUuid(uuid)) {
    throw new Error("A valid UUID is required");
  }

  const result = await runJxa("vm_control.js", ["serial", uuid]);

  if (result.status === "error" || !result.address) {
    throw new Error(result.message || "Serial port address not available");
  }

  return result.address;
};
