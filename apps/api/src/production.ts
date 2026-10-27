import { log } from "@repo/logger";
import { UtmAdapter } from "@repo/utm-adapter";
import { createProductionRuntime } from "./productionRuntime";

const main = async () => {
  const rawPort = process.env.PORT || "3000";
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be an integer from 1 to 65535");
  const server = await createProductionRuntime(new UtmAdapter());
  server.listen(port, "127.0.0.1", () => {
    log(`UTM Web running on http://127.0.0.1:${port}`);
  });
};

void main().catch((error: unknown) => {
  log(`UTM Web failed to start: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
