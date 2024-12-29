import { createServer } from "./server";
import { log } from "@repo/logger";
import http from "http";
import { WebSocketServer } from "ws";
import { spawn } from "node-pty";
import { getPtyDevice } from "./utils/getPtyDevice";

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
wss.on("connection", async (ws, req) => {
  const urlParams = new URLSearchParams(req.url?.split('?')[1]);

  var vmUUID = urlParams.get('vmUUID');
  

  if (!vmUUID) {
    // log("VM UUID not provided");
    // Hard code the VM UUID for testing
    vmUUID = "5D28BFD8-AB32-46A7-8BE4-123892B7A9C3";
    // ws.close();
    // return;
  }

  log(`WebSocket connection established for VM: ${vmUUID}`);

  const ptyDevice = await getPtyDevice(vmUUID);
  log(`PTY device for VM ${vmUUID}: ${ptyDevice}`);

  // spawn a proccess specific to the VM UUID
  const ptyProcess = spawn("screen", [ptyDevice], {
    name: "xterm-color",
    env: { 
      ...process.env,
      LANG: "en_US.UTF-8",
    },
  });

  // on every message, send it to the bash process
  ws.on("message", (message) => {
    console.log(`received: ${message}`);
    // websocket messages are strings, so we need to parse them
    const data = JSON.parse(message.toString());

    if (data.type === "command") {
      ptyProcess.write(data.data);
    }

    if (data.type === "resize") {
      ptyProcess.resize(data.cols, data.rows);
    }
  });
  
  ptyProcess.onData((data) => {
    const message = JSON.stringify({
      type: "data",
      data: data.toString(),
    });

    ws.send(message);
  });

  ws.on("close", () => {
    console.log("closed ws");
    // kill the process when the ws connection is closed
    // multiple screen will garble the terminal
    ptyProcess.kill("SIGTERM"); // Gracefully kill the screen process
    // TODO: Screen still exists after the ws connection is closed
    // This causes the terminal to be garbled when a new ws connection is established
  });

});