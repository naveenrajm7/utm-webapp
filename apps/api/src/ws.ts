import { execFile } from "child_process";
import type { IncomingMessage, Server as HttpServer } from "http";
import net from "net";
import { spawn } from "node-pty";
import { WebSocket, WebSocketServer } from "ws";
import { log } from "@repo/logger";
import { isAuthorizedRequest } from "./auth";
import { getPtyDevice } from "./utils/getPtyDevice";
import { getVncTarget } from "./utils/getVncTarget";
import { isValidUuid } from "./utils/runJxa";

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

  const ptyProcess = spawn("screen", ["-S", sessionName, ptyDevice], {
    name: "xterm-color",
    env: {
      ...process.env,
      LANG: "en_US.UTF-8",
    },
  });

  ws.on("message", (message, isBinary) => {
    try {
      if (isBinary) throw new Error("Serial input must be JSON");
      const data: unknown = JSON.parse(message.toString());
      if (!data || typeof data !== "object")
        throw new Error("Invalid serial input");
      const input = data as Record<string, unknown>;
      if (
        input.type === "command" &&
        typeof input.data === "string" &&
        input.data.length <= 16384
      ) {
        ptyProcess.write(input.data);
      } else if (
        input.type === "resize" &&
        Number.isInteger(input.cols) &&
        Number.isInteger(input.rows) &&
        typeof input.cols === "number" &&
        typeof input.rows === "number" &&
        input.cols >= 1 &&
        input.cols <= 500 &&
        input.rows >= 1 &&
        input.rows <= 200
      ) {
        ptyProcess.resize(input.cols, input.rows);
      } else {
        throw new Error("Invalid serial input");
      }
    } catch {
      ws.close(1008, "invalid input");
    }
  });

  ptyProcess.onData((data) => {
    ws.send(JSON.stringify({ type: "data", data: data.toString() }));
  });

  ws.on("close", () => {
    ptyProcess.kill("SIGTERM");

    execFile(
      "screen",
      ["-X", "-S", sessionName, "quit"],
      { timeout: 5000 },
      () => {
        log(`Serial session ${sessionName} closed`);
      },
    );
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

  ws.on("message", (message, isBinary) => {
    if (!isBinary) {
      ws.close(1008, "binary input required");
      return;
    }
    socket.write(message as Buffer);
  });

  ws.on("close", () => {
    socket.destroy();
  });
};

export const handleWebSocketConnection = async (
  ws: WebSocket,
  req: IncomingMessage,
) => {
  let url: URL;
  try {
    url = new URL(req.url || "/", "http://localhost");
  } catch {
    ws.close(1008, "invalid path");
    return;
  }

  if (!isAuthorizedRequest(req, url)) {
    ws.close(1008, "unauthorized");
    return;
  }

  if (url.pathname !== "/" && url.pathname !== "/vnc") {
    ws.close(1008, "invalid path");
    return;
  }
  const vmUUID = url.searchParams.get("vmUUID");
  if (
    !isValidUuid(vmUUID) ||
    url.searchParams.getAll("vmUUID").length !== 1 ||
    [...url.searchParams.keys()].some(
      (key) => key !== "vmUUID" && key !== "token",
    )
  ) {
    ws.close(1008, "invalid VM ID");
    return;
  }

  log(`WebSocket connection established for VM: ${vmUUID} (${url.pathname})`);

  if (url.pathname === "/vnc") {
    await attachVnc(ws, vmUUID);
    return;
  }

  await attachSerial(ws, vmUUID);
};

export const attachWebSocketServer = (server: HttpServer): WebSocketServer => {
  // noVNC asks for the "binary" subprotocol, so accept it.
  const wss = new WebSocketServer({
    server,
    maxPayload: 1024 * 1024,
    handleProtocols: (protocols: Set<string>) =>
      protocols.has("binary") ? "binary" : false,
  });

  wss.on("connection", (ws, req) => {
    void handleWebSocketConnection(ws, req).catch((error: unknown) => {
      log(
        `WebSocket bridge failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      if (ws.readyState === WebSocket.OPEN)
        ws.close(1011, "bridge unavailable");
    });
  });

  return wss;
};
