import { execFile } from "child_process";
import type { IncomingMessage, Server as HttpServer } from "http";
import net from "net";
import type { Duplex } from "node:stream";
import { spawn } from "node-pty";
import { WebSocket, WebSocketServer } from "ws";
import { log } from "@repo/logger";
import { isAuthorizedRequest } from "./auth";
import type { ConsoleResolver } from "./services/consoleResolver";
import { isValidUuid } from "./utils/uuid";
import { isAllowedWebSocketOrigin, isSameOriginWebSocket } from "./webOrigin";

export type WebSocketMode = "development" | "single-origin";

const consolePath = (path: string, mode: WebSocketMode): "serial" | "vnc" | null => {
  if (path === "/ws/serial" || (mode === "development" && path === "/")) return "serial";
  if (path === "/ws/vnc" || (mode === "development" && path === "/vnc")) return "vnc";
  return null;
};

/** Serial clients render whatever they receive, so errors are shown as output. */
const sendSerialNotice = (ws: WebSocket, text: string) => {
  ws.send(JSON.stringify({ type: "data", data: `\r\n${text}\r\n` }));
};

const attachSerial = async (ws: WebSocket, vmUUID: string, resolver: ConsoleResolver) => {
  let ptyDevice: string;
  try {
    ptyDevice = await resolver.getSerialDevice(vmUUID);
  } catch (error) {
    const message = (error as Error).message;
    log(`Could not attach to VM ${vmUUID}: ${message}`);
    if (ws.readyState === WebSocket.OPEN) {
      sendSerialNotice(ws, "Cannot attach to serial console: console unavailable");
      ws.close();
    }
    return;
  }

  if (ws.readyState !== WebSocket.OPEN) return;

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
const attachVnc = async (ws: WebSocket, vmUUID: string, resolver: ConsoleResolver) => {
  let target;
  try {
    target = await resolver.getVncTarget(vmUUID);
    if (
      !["127.0.0.1", "localhost", "::1"].includes(target.host) ||
      !Number.isInteger(target.port) || target.port < 1 || target.port > 65535
    ) throw new Error("VNC target must be on loopback");
  } catch (error) {
    const message = (error as Error).message;
    log(`Could not bridge VNC for VM ${vmUUID}: ${message}`);
    if (ws.readyState === WebSocket.OPEN) ws.close(1011, "console unavailable");
    return;
  }

  if (ws.readyState !== WebSocket.OPEN) return;

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
  resolver: ConsoleResolver,
  mode: WebSocketMode = "development",
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

  if (mode === "single-origin"
    ? !isSameOriginWebSocket(req)
    : !isAllowedWebSocketOrigin(req.headers.origin)) {
    ws.close(1008, "invalid origin");
    return;
  }

  const kind = consolePath(url.pathname, mode);
  if (!kind) {
    ws.close(1008, "invalid path");
    return;
  }
  const vmUUID = url.searchParams.get("vmUUID");
  if (
    !isValidUuid(vmUUID) ||
    url.searchParams.getAll("vmUUID").length !== 1 ||
    [...url.searchParams.keys()].some((key) => key !== "vmUUID")
  ) {
    ws.close(1008, "invalid VM ID");
    return;
  }

  log(`WebSocket connection established for VM: ${vmUUID} (${url.pathname})`);

  if (kind === "vnc") {
    await attachVnc(ws, vmUUID, resolver);
    return;
  }

  await attachSerial(ws, vmUUID, resolver);
};

export const attachWebSocketServer = (
  server: HttpServer,
  resolver: ConsoleResolver,
  mode: WebSocketMode = "development",
): WebSocketServer => {
  // noVNC asks for the "binary" subprotocol, so accept it.
  const wss = new WebSocketServer({
    ...(mode === "single-origin" ? { noServer: true } : { server }),
    maxPayload: 1024 * 1024,
    handleProtocols: (protocols: Set<string>) =>
      protocols.has("binary") ? "binary" : protocols.has("utm-auth") ? "utm-auth" : false,
  });

  wss.on("connection", (ws, req) => {
    void handleWebSocketConnection(ws, req, resolver, mode).catch((error: unknown) => {
      log(
        `WebSocket bridge failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      if (ws.readyState === WebSocket.OPEN)
        ws.close(1011, "bridge unavailable");
    });
  });

  if (mode === "single-origin") {
    const reject = (socket: Duplex, status: number, message: string) => {
      socket.end(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    };
    server.on("upgrade", (req, socket, head) => {
      let url: URL;
      try {
        url = new URL(req.url || "/", "http://localhost");
      } catch {
        reject(socket, 400, "Bad Request");
        return;
      }
      if (!consolePath(url.pathname, mode)) {
        reject(socket, 404, "Not Found");
      } else if (!isSameOriginWebSocket(req)) {
        reject(socket, 403, "Forbidden");
      } else if (!isAuthorizedRequest(req, url)) {
        reject(socket, 401, "Unauthorized");
      } else if (!isValidUuid(url.searchParams.get("vmUUID")) ||
        url.searchParams.getAll("vmUUID").length !== 1 ||
        [...url.searchParams.keys()].some(key => key !== "vmUUID")) {
        reject(socket, 400, "Bad Request");
      } else {
        wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws, req));
      }
    });
    server.on("close", () => wss.close());
  }

  return wss;
};
