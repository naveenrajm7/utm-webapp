import { createServer } from "./server";
import { log } from "@repo/logger";
import http from "http";
import { WebSocketServer } from "ws";
import { spawn } from "node-pty";

// one port, one express app
const port = process.env.PORT || 3001;
const app = createServer();

// API server
const server = http.createServer(app);
// WebSocket server
const wss = new WebSocketServer({ server });

server.listen(port, () => {
  log(`api running on ${port}`);
});

// on every connection, spawn a new zsh process
wss.on("connection", (ws) => {
  const ptyProcess = spawn("screen", ["/dev/ttys027"], {
    name: "xterm-color",
    env: process.env,
  });

  // on every message, send it to the bash process
  ws.on("message", (message) => {
    console.log(`received: ${message}`);
    // websocket messages are strings, so we need to parse them
    const data = JSON.parse(message.toString());

    if (data.type === "command") {
      ptyProcess.write(data.data);
    }
  });

  ptyProcess.onData((data) => {
    const message = JSON.stringify({
      type: "data",
      data,
    });

    ws.send(message);
  });

  ws.on("close", () => {
    console.log("closed ws");
  });

});