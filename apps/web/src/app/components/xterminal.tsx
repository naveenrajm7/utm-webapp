"use client";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import "@xterm/xterm/css/xterm.css";
import { getAuthenticatedWebSocketUrl } from "../apiAuth";
import { IS_DEMO } from "../demo";

interface XTerminalProps {
  vmUUID: string;
}

function XTerminal({ vmUUID }: XTerminalProps) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const shell = shellRef.current;
    const host = terminalRef.current;
    if (!shell || !host) return;

    const term = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      fontSize: 14,
      theme: {
        background: "#111111",
        foreground: "#e8e8e8",
        cursor: "#e8e8e8",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);

    const fitSoon = () => {
      fit.fit();
    };
    const frame = window.requestAnimationFrame(fitSoon);
    const observer = new ResizeObserver(fitSoon);
    observer.observe(shell);

    if (IS_DEMO) {
      let detach: (() => void) | undefined;
      let disposed = false;
      void import("../demo/demoShell").then(({ attachDemoShell }) => {
        if (!disposed) detach = attachDemoShell(term);
      });
      return () => {
        disposed = true;
        detach?.();
        window.cancelAnimationFrame(frame);
        observer.disconnect();
        term.dispose();
      };
    }

    const ws = new WebSocket(getAuthenticatedWebSocketUrl("/", { vmUUID }));

    ws.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      try {
        const data = JSON.parse(event.data) as { type?: string; data?: string };
        if (data.type === "data" && typeof data.data === "string") {
          term.write(data.data);
        }
      } catch {
        term.write(event.data);
      }
    };

    ws.onopen = () => {
      fitSoon();
    };

    term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    });

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "command", data }));
      }
    });

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      ws.close();
      term.dispose();
    };
  }, [vmUUID]);

  return (
    <div ref={shellRef} className="terminal-shell">
      <div ref={terminalRef} className="terminal-host" />
    </div>
  );
}

export default XTerminal;
