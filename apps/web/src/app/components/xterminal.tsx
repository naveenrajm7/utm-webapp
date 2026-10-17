"use client";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";
import { getAuthenticatedWebSocketUrl, getWebSocketProtocols } from "../apiAuth";
import { IS_DEMO } from "../demo";

interface XTerminalProps {
  vmUUID: string;
  onDisconnect?: () => void;
}

type SerialHint = "connecting" | "quiet" | "live" | "failed";

function XTerminal({ vmUUID, onDisconnect }: XTerminalProps) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const [hint, setHint] = useState<SerialHint>("connecting");

  useEffect(() => {
    const shell = shellRef.current;
    const host = terminalRef.current;
    if (!shell || !host) return;
    setHint("connecting");

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
    term.focus();

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
        if (disposed) return;
        detach = attachDemoShell(term);
        term.focus();
        setHint("live");
      });
      return () => {
        disposed = true;
        detach?.();
        window.cancelAnimationFrame(frame);
        observer.disconnect();
        term.dispose();
      };
    }

    let disposed = false;
    let sawOutput = false;
    let failed = false;
    let ws: WebSocket | null = null;

    const fail = () => {
      if (disposed || failed) return;
      failed = true;
      setHint("failed");
      onDisconnect?.();
    };

    try {
      ws = new WebSocket(getAuthenticatedWebSocketUrl("/ws/serial", { vmUUID }), getWebSocketProtocols());
    } catch {
      fail();
    }

    if (ws) ws.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      try {
        const data = JSON.parse(event.data) as { type?: string; data?: string };
        if (data.type === "data" && typeof data.data === "string") {
          term.write(data.data);
          if (data.data.length > 0) {
            sawOutput = true;
            setHint("live");
          }
          return;
        }
      } catch {
        term.write(event.data);
        sawOutput = true;
        setHint("live");
      }
    };

    if (ws) ws.onopen = () => {
      fitSoon();
      term.focus();
      if (!sawOutput) setHint("quiet");
    };

    if (ws) ws.onerror = fail;

    if (ws) ws.onclose = fail;

    const resizeSubscription = term.onResize(({ cols, rows }) => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    });

    const dataSubscription = term.onData((data) => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "command", data }));
      }
    });

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      resizeSubscription.dispose();
      dataSubscription.dispose();
      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        ws.close();
      }
      term.dispose();
    };
  }, [vmUUID, onDisconnect]);

  const hintText =
    hint === "connecting"
      ? "Connecting to the serial console…"
      : hint === "failed"
        ? "Serial connection lost. Reconnect to try again."
        : "Connected. Press Enter for login.";

  return (
    <div ref={shellRef} className="terminal-shell">
      {hint !== "live" && (
        <p className={`terminal-hint ${hint === "failed" ? "is-failed" : ""}`} role="status">
          {hintText}
        </p>
      )}
      <div ref={terminalRef} className="terminal-host" />
    </div>
  );
}

export default XTerminal;
