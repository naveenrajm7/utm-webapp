"use client";

import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import "@xterm/xterm/css/xterm.css";
import { getApiWebSocketHost } from "../config";

interface XTerminalProps {
  vmUUID: string;
}

function XTerminal({ vmUUID }: XTerminalProps) {
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    // Create a new terminal instance
    const term = new Terminal({
      convertEol: true, // Handle newlines properly
    });
    termRef.current = term;

    // The API serves the serial console on its root WebSocket path.
    const ws = new WebSocket(`${getApiWebSocketHost()}?vmUUID=${vmUUID}`);
    wsRef.current = ws;

    // on every message from ws, write it to the terminal
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "data") term.write(data.data);
    };

    // Open the terminal in the DOM element
    if (terminalRef.current) {
      term.open(terminalRef.current);
    }

    term.onResize(({ cols, rows }) => {
      ws.send(
        JSON.stringify({
          type: "resize",
          cols,
          rows,
        })
      );
    });

    term.onKey((e) => {
      ws.send(
        JSON.stringify({
          type: "command",
          data: e.key,
        }),
      );
    });

    // when the component unmounts
    // close the ws connection and dispose the terminal 
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (termRef.current) {
        termRef.current.dispose();
      }
    };
  }, [vmUUID]);

  return (
    <div ref={terminalRef} style={{ width: "100%", height: "100%" }}></div>
  );
}

export default XTerminal;
