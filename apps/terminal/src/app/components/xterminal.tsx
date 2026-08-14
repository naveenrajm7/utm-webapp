"use client";

import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import "@xterm/xterm/css/xterm.css";

function XTerminal() {
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const vmUUID = urlParams.get('vmUUID');

    if (!vmUUID) {
      console.error("VM UUID not provided");
      return;
    }

    // Create a new terminal instance
    const term = new Terminal({
      convertEol: true, // Handle newlines properly
    });
    termRef.current = term;

    // The API serves its WebSocket on 3001 of whichever host served this page,
    // so a hardcoded localhost would point at the viewer's own machine.
    const scheme = window.location.protocol === "https:" ? "wss" : "ws";
    const apiHost = process.env.NEXT_PUBLIC_API_WS_HOST || `${window.location.hostname}:3001`;

    const ws = new WebSocket(`${scheme}://${apiHost}?vmUUID=${vmUUID}`);
    wsRef.current = ws;

    // on every message from ws, write it to the terminal
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "data") term.write(data.data);
    };

    // Handle terminal data input, is this same as onKey?
    // term.onData((data) => {
    //   ws.send(JSON.stringify({ type: "command", data }));
    // });

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
  }, [terminalRef]);

  return (
    <div ref={terminalRef} style={{ width: "100%", height: "100%" }}></div>
  );
}

export default XTerminal;