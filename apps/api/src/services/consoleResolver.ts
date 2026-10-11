import { getPtyDevice } from "../utils/getPtyDevice";
import { getVncTarget, type VncTarget } from "../utils/getVncTarget";

/** Swap this boundary for adapter console methods after the adapter branch lands. */
export interface ConsoleResolver {
  getSerialDevice(id: string): Promise<string>;
  getVncTarget(id: string): Promise<VncTarget>;
}

export const legacyConsoleResolver: ConsoleResolver = {
  getSerialDevice: getPtyDevice,
  getVncTarget,
};
