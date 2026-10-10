import { createServer } from "./server";
import { log } from "@repo/logger";
import http from "http";
import { assertApiKeyConfigured } from "./auth";
import { attachWebSocketServer } from "./ws";

assertApiKeyConfigured();

const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || "127.0.0.1";
const app = createServer();
const server = http.createServer(app);

attachWebSocketServer(server);

server.listen(port, host, () => {
  log(`api running on ${host}:${port}`);
});
