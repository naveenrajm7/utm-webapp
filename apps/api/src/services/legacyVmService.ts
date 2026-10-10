import { runJxa } from "../utils/runJxa";

/** Compatibility service for the unversioned browser routes. */
export const listLegacyVms = () => runJxa<unknown>("list_vm.js");
export const getLegacyVmInfo = (id: string) =>
  runJxa<Record<string, unknown>>("get_vm_info.js", [id]);
export const controlLegacyVm = (
  action: "start" | "stop" | "status",
  id: string,
) => runJxa("vm_control.js", [action, id]);
