/**
 * Demo builds (`npm run build:demo`) export a static site for GitHub Pages.
 * They replace the local API with an in-browser simulation, so they must never
 * be pointed at a real UTM host.
 */
export const IS_DEMO = process.env.NEXT_PUBLIC_DEMO === "1";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

export const consolePath = (kind: "terminal" | "vnc", vmId: string): string =>
  `${BASE_PATH}/${kind}/${encodeURIComponent(vmId)}${IS_DEMO ? "/" : ""}`;
