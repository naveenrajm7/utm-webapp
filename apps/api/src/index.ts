import { log } from "@repo/logger";
import { UtmAdapter } from "@repo/utm-adapter";
import { createLocalRuntime } from "./localRuntime";
import { configuredApiHost } from "./webOrigin";

const port = Number(process.env.PORT || 3001);
const host = configuredApiHost();
const server = createLocalRuntime(new UtmAdapter());

server.listen(port, host, () => {
  log(`api running on ${host}:${port}`);
});
