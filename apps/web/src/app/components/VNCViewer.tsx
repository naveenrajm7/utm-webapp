"use client";

import { useEffect, useRef, useState } from "react";
import { IS_DEMO } from "../demo";
import DemoDisplay from "../demo/DemoDisplay";
import { getWebSocketProtocols } from "../apiAuth";

interface VNCViewerProps {
  url: string;
  onDisconnect?: () => void;
}

interface RfbClient {
  disconnect: () => void;
  addEventListener: (type: "connect" | "disconnect", listener: () => void) => void;
  removeEventListener: (type: "connect" | "disconnect", listener: () => void) => void;
}

interface RfbConstructor {
  new (target: HTMLElement, url: string, options?: Record<string, unknown>): RfbClient;
}

export const LiveVNCViewer = ({ url, onDisconnect }: VNCViewerProps) => {
  const vncContainerRef = useRef<HTMLDivElement | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [detail, setDetail] = useState("Connecting to the display…");

  useEffect(() => {
    const target = vncContainerRef.current;
    if (!target) return;

    let cancelled = false;
    let rfb: RfbClient | null = null;
    setPhase("connecting");
    setDetail("Connecting to the display…");

    const disconnected = () => {
      if (cancelled) return;
      setPhase("disconnected");
      setDetail("The display connection was lost. Try reconnecting.");
      onDisconnect?.();
    };
    const connected = () => {
      if (!cancelled) setPhase("connected");
    };

    import("@novnc/novnc/lib/rfb")
      .then((module: { default: RfbConstructor }) => {
        if (cancelled || !vncContainerRef.current) return;

        try {
          rfb = new module.default(vncContainerRef.current, url, {
            scaleViewport: true,
            resizeSession: false,
            wsProtocols: getWebSocketProtocols(true),
          });
          rfb.addEventListener("connect", connected);
          rfb.addEventListener("disconnect", disconnected);
        } catch {
          disconnected();
        }
      })
      .catch(() => {
        if (cancelled) return;
        setPhase("disconnected");
        setDetail("The display viewer failed to load.");
        onDisconnect?.();
      });

    return () => {
      cancelled = true;
      rfb?.removeEventListener("connect", connected);
      rfb?.removeEventListener("disconnect", disconnected);
      rfb?.disconnect();
    };
  }, [url, attempt, onDisconnect]);

  return (
    <div className="vnc-shell">
      <div ref={vncContainerRef} className="vnc-canvas" />
      {phase !== "connected" && (
        <div className="vnc-overlay">
          <p>{detail}</p>
          {phase === "disconnected" && !onDisconnect && (
            <button type="button" className="text-button" onClick={() => setAttempt((value) => value + 1)}>
              Try again
            </button>
          )}
        </div>
      )}
    </div>
  );
};

const VNCViewer = ({ url }: VNCViewerProps) =>
  IS_DEMO ? <DemoDisplay url={url} /> : <LiveVNCViewer url={url} />;

export default VNCViewer;
