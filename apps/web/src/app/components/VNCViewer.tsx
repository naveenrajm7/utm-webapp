"use client";

import { useEffect, useRef, useState } from "react";
import { IS_DEMO } from "../demo";
import DemoDisplay from "../demo/DemoDisplay";

interface VNCViewerProps {
  url: string;
}

interface RfbClient {
  disconnect: () => void;
  addEventListener: (type: "connect" | "disconnect", listener: () => void) => void;
}

interface RfbConstructor {
  new (target: HTMLElement, url: string, options?: Record<string, unknown>): RfbClient;
}

const NO_DISPLAY =
  "This virtual machine has no VNC display. Add a -vnc 127.0.0.1:<n> QEMU argument in UTM, or use the serial console.";

const LiveVNCViewer = ({ url }: VNCViewerProps) => {
  const vncContainerRef = useRef<HTMLDivElement | null>(null);
  const connectedRef = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [detail, setDetail] = useState("Connecting to the display…");

  useEffect(() => {
    const target = vncContainerRef.current;
    if (!target) return;

    let cancelled = false;
    let rfb: RfbClient | null = null;
    connectedRef.current = false;
    setPhase("connecting");
    setDetail("Connecting to the display…");

    import("@novnc/novnc/lib/rfb")
      .then((module: { default: RfbConstructor }) => {
        if (cancelled || !vncContainerRef.current) return;

        rfb = new module.default(vncContainerRef.current, url, {
          scaleViewport: true,
          resizeSession: false,
        });

        rfb.addEventListener("connect", () => {
          connectedRef.current = true;
          setPhase("connected");
        });

        rfb.addEventListener("disconnect", () => {
          setPhase("disconnected");
          setDetail(
            connectedRef.current ? "The display disconnected." : NO_DISPLAY,
          );
        });
      })
      .catch(() => {
        if (cancelled) return;
        setPhase("disconnected");
        setDetail("The display viewer failed to load.");
      });

    return () => {
      cancelled = true;
      rfb?.disconnect();
    };
  }, [url, attempt]);

  return (
    <div className="vnc-shell">
      <div ref={vncContainerRef} className="vnc-canvas" />
      {phase !== "connected" && (
        <div className="vnc-overlay">
          <p>{detail}</p>
          {phase === "disconnected" && (
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
  IS_DEMO ? <DemoDisplay /> : <LiveVNCViewer url={url} />;

export default VNCViewer;
