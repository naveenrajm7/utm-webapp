#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createApiClient } from "./api-client.js";
import { createMcpServer } from "./server.js";

try {
  const api = createApiClient({
    baseUrl: process.env.UTM_API_URL,
    apiKey: process.env.UTM_API_KEY,
  });
  serveStdio(() => createMcpServer(api));
} catch (error) {
  console.error(error instanceof Error ? error.message : "MCP server failed to start");
  process.exitCode = 1;
}
