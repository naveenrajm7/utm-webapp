import { createServer } from "./server";
import { log } from "@repo/logger";
import http from "http";
import { assertApiKeyConfigured } from "./auth";
import { attachWebSocketServer } from "./ws";

assertApiKeyConfigured();

const port = process.env.PORT || 3001;
const app = createServer();
const server = http.createServer(app);

attachWebSocketServer(server);

server.listen(port, () => {
  log(`api running on ${port}`);
});
