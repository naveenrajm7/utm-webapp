import type { UtmPort as AdapterPort } from "@repo/utm-adapter";

/** Console endpoints come from the same adapter as VM inventory and power. */
export type ConsoleResolver = Pick<AdapterPort, "getSerialDevice" | "getVncTarget">;
