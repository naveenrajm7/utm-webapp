"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { getVm } from "../v1";
import { canOpenConsole, hasCapability, type VM } from "../vm";

export type ConsoleKind = "display" | "serial";

export const consoleAvailability = (vm: VM, kind: ConsoleKind) => {
  if (!hasCapability(vm, kind))
    return { ready: false, message: `This virtual machine has no supported ${kind} console.` };
  if (!canOpenConsole(vm.status))
    return { ready: false, message: `Start ${vm.name} to open the ${kind} console.` };
  return { ready: true, message: "" };
};

export default function ConsoleGate({
  vmId, kind, children,
}: {
  vmId: string;
  kind: ConsoleKind;
  children: (onDisconnect: () => void) => ReactNode;
}) {
  const [vm, setVm] = useState<VM | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnected, setDisconnected] = useState(false);
  const request = useRef(0);
  const handleDisconnect = useCallback(() => setDisconnected(true), []);
  const refresh = useCallback(async () => {
    const current = ++request.current;
    setLoading(true);
    try {
      const next = await getVm(vmId);
      if (current !== request.current) return;
      setVm(next);
      setError(null);
      setDisconnected(false);
    } catch (caught) {
      if (current !== request.current) return;
      setVm(null);
      setError(caught instanceof Error ? caught.message : "Could not load virtual machine");
    } finally {
      if (current === request.current) setLoading(false);
    }
  }, [vmId]);

  useEffect(() => {
    void refresh();
    return () => { request.current++; };
  }, [refresh]);

  if (loading) return <div className="console-gate" role="status"><p>Checking console availability…</p></div>;
  if (error || !vm) return (
    <div className="console-gate" role="alert">
      <p>{error || "Virtual machine unavailable."}</p>
      <button type="button" className="push-button" onClick={() => void refresh()}>Retry</button>
    </div>
  );
  const availability = consoleAvailability(vm, kind);
  if (!availability.ready) return (
    <div className="console-gate" role="status">
      <p>{availability.message}</p>
      <button type="button" className="push-button" onClick={() => void refresh()}>Refresh status</button>
    </div>
  );
  if (disconnected) return (
    <div className="console-gate" role="alert">
      <p>The {kind} connection was lost. The console may still be available.</p>
      <button type="button" className="push-button" onClick={() => void refresh()}>Reconnect</button>
    </div>
  );
  return <>{children(handleDisconnect)}</>;
}
