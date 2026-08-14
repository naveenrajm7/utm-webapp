import { createServer } from "./server";
import { log } from "@repo/logger";
import { exec } from "child_process";
import http from "http";
import net from "net";
import { WebSocket, WebSocketServer } from "ws";
import { spawn } from "node-pty";
import { getPtyDevice } from "./utils/getPtyDevice";
import { getVncTarget } from "./utils/getVncTarget";

// one port, one express app
const port = process.env.PORT || 3001;
const app = createServer();

// API server
const server = http.createServer(app);
// WebSocket server: "/vnc" bridges to the VM's VNC display, anything else is
// the serial console. noVNC asks for the "binary" subprotocol, so accept it.
const wss = new WebSocketServer({
  server,
  handleProtocols: (protocols: Set<string>) => (protocols.has("binary") ? "binary" : false),
});

server.listen(port, () => {
  log(`api running on ${port}`);
});

/** Serial clients render whatever they receive, so errors are shown as output. */
const sendSerialNotice = (ws: WebSocket, text: string) => {
  ws.send(JSON.stringify({ type: "data", data: `\r\n${text}\r\n` }));
};

const attachSerial = async (ws: WebSocket, vmUUID: string) => {
  let ptyDevice: string;
  try {
    ptyDevice = await getPtyDevice(vmUUID);
  } catch (error) {
    const message = (error as Error).message;
    log(`Could not attach to VM ${vmUUID}: ${message}`);
    sendSerialNotice(ws, `Cannot attach to serial console: ${message}`);
    ws.close();
    return;
  }

  log(`PTY device for VM ${vmUUID}: ${ptyDevice}`);

  // Killing the screen client only detaches it, leaving a session that keeps
  // reading the serial device and stealing bytes from later connections, so
  // name the session and quit it explicitly on disconnect.
  const sessionName = `utmweb-${vmUUID}-${Date.now()}`;

  // spawn a proccess specific to the VM UUID
  const ptyProcess = spawn("screen", ["-S", sessionName, ptyDevice], {
    name: "xterm-color",
    env: {
      ...process.env,
      LANG: "en_US.UTF-8",
    },
  });

  // on every message, send it to the bash process
  ws.on("message", (message) => {
    const data = JSON.parse(message.toString());

    if (data.type === "command") {
      ptyProcess.write(data.data);
    }

    if (data.type === "resize") {
      ptyProcess.resize(data.cols, data.rows);
    }
  });

  ptyProcess.onData((data) => {
    ws.send(JSON.stringify({ type: "data", data: data.toString() }));
  });

  ws.on("close", () => {
    ptyProcess.kill("SIGTERM");

    exec(`screen -X -S ${sessionName} quit`, () => {
      log(`Serial session ${sessionName} closed`);
    });
  });
};

/**
 * QEMU serves VNC over plain TCP on the host, but noVNC in the browser can only
 * speak WebSocket, so relay bytes between the two.
 */
const attachVnc = async (ws: WebSocket, vmUUID: string) => {
  let target;
  try {
    target = await getVncTarget(vmUUID);
  } catch (error) {
    const message = (error as Error).message;
    log(`Could not bridge VNC for VM ${vmUUID}: ${message}`);
    ws.close(1011, message);
    return;
  }

  const socket = net.connect(target.port, target.host);

  socket.on("connect", () => {
    log(`VNC bridge open for VM ${vmUUID} -> ${target.host}:${target.port}`);
  });

  socket.on("data", (chunk) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(chunk);
    }
  });

  socket.on("error", (error) => {
    log(`VNC socket error for VM ${vmUUID}: ${error.message}`);
    ws.close();
  });

  socket.on("close", () => ws.close());

  ws.on("message", (message) => socket.write(message as Buffer));

  ws.on("close", () => {
    socket.destroy();
  });
};

wss.on("connection", async (ws, req) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const vmUUID = url.searchParams.get("vmUUID");

  if (!vmUUID) {
    log("VM UUID not provided");
    ws.close();
    return;
  }

  log(`WebSocket connection established for VM: ${vmUUID} (${url.pathname})`);

  if (url.pathname === "/vnc") {
    await attachVnc(ws, vmUUID);
    return;
  }

  await attachSerial(ws, vmUUID);
});
