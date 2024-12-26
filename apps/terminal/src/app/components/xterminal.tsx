"use client";

import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import "@xterm/xterm/css/xterm.css";

const term : Terminal = new Terminal({
                              convertEol: true, // Handle newlines properly
                            });

const ws = new WebSocket("ws://localhost:3001");

function XTerminal() {
  const terminalRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    // on every message from ws, write it to the terminal
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "data") term.write(data.data);
    };

    // close the ws connection when the component unmounts
    return () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    if (!terminalRef.current) return;

    term.open(terminalRef.current);

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

  },[terminalRef])

  return (
    <div ref={terminalRef} style={{ width: "100%", height: "100%" }}></div>
  );
}

export default XTerminal;