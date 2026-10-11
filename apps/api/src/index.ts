import { log } from "@repo/logger";
import { UtmAdapter } from "@repo/utm-adapter";
import { assertApiKeyConfigured } from "./auth";
import { createLocalRuntime } from "./localRuntime";
import { configuredApiHost } from "./webOrigin";

assertApiKeyConfigured();

const port = Number(process.env.PORT || 3001);
const host = configuredApiHost();
const server = createLocalRuntime(new UtmAdapter());

server.listen(port, host, () => {
  log(`api running on ${host}:${port}`);
});
