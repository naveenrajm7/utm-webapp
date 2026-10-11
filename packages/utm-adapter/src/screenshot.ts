import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_SCREENSHOT_BYTES = 1_500_000;
const MAX_CONFIG_BYTES = 2_000_000;
const MAX_DATA_URL_LENGTH = 2_100_000;

/** UTM saves the last frame here when screenshot capture is enabled. */
export const utmDocumentsDir = (): string =>
  path.join(os.homedir(), "Library/Containers/com.utmapp.UTM/Data/Documents");

export const acceptScreenshot = (value: string | undefined): string | undefined => {
  if (!value || !value.startsWith("data:image/png;base64,")) return undefined;
  if (value.length > MAX_DATA_URL_LENGTH) return undefined;
  const payload = value.slice("data:image/png;base64,".length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) return undefined;
  return value;
};

const inside = (root: string, candidate: string): boolean =>
  candidate === root || candidate.startsWith(root + path.sep);

const configContainsUuid = async (configPath: string, id: string): Promise<boolean> => {
  const stat = await fs.lstat(configPath);
  if (!stat.isFile() || stat.size > MAX_CONFIG_BYTES) return false;
  const bytes = await fs.readFile(configPath);
  return bytes.toString("latin1").toLowerCase().includes(id.toLowerCase());
};

/**
 * Read `screenshot.png` from a `.utm` package under `root` whose config names `id`.
 * Returns a PNG data URL, or undefined when UTM has no saved frame.
 */
export const readSavedScreenshot = async (root: string, id: string): Promise<string | undefined> => {
  let rootReal: string;
  try {
    const rootStat = await fs.lstat(root);
    if (!rootStat.isDirectory()) return undefined;
    rootReal = await fs.realpath(root);
  } catch {
    return undefined;
  }
  const entries = await fs.readdir(rootReal);
  for (const entry of entries) {
    if (!entry.endsWith(".utm")) continue;
    const bundle = path.join(rootReal, entry);
    let bundleReal: string;
    try {
      const stat = await fs.lstat(bundle);
      if (!stat.isDirectory() && !stat.isSymbolicLink()) continue;
      bundleReal = await fs.realpath(bundle);
    } catch {
      continue;
    }
    if (!inside(rootReal, bundleReal)) continue;
    let matches = false;
    try {
      matches = await configContainsUuid(path.join(bundleReal, "config.plist"), id);
    } catch {
      matches = false;
    }
    if (!matches) continue;
    const shot = path.join(bundleReal, "screenshot.png");
    try {
      const stat = await fs.lstat(shot);
      if (!stat.isFile() || stat.size < PNG_MAGIC.length || stat.size > MAX_SCREENSHOT_BYTES) return undefined;
      const shotReal = await fs.realpath(shot);
      if (!inside(bundleReal, shotReal)) return undefined;
      const bytes = await fs.readFile(shotReal);
      if (!bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) return undefined;
      return `data:image/png;base64,${bytes.toString("base64")}`;
    } catch {
      return undefined;
    }
  }
  return undefined;
};
