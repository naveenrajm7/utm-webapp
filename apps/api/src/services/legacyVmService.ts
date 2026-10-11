import { runJxa } from "../utils/runJxa";

/** Temporary detail fallback until the adapter detail branch is integrated. */
export const getLegacyVmInfo = (id: string) =>
  runJxa<Record<string, unknown>>("get_vm_info.js", [id]);
