"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
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
  children: ReactNode;
}) {
  const [vm, setVm] = useState<VM | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setVm(await getVm(vmId));
      setError(null);
    } catch (caught) {
      setVm(null);
      setError(caught instanceof Error ? caught.message : "Could not load virtual machine");
    } finally {
      setLoading(false);
    }
  }, [vmId]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (loading) return <p role="status">Checking console availability…</p>;
  if (error || !vm) return (
    <div role="alert">
      <p>{error || "Virtual machine unavailable."}</p>
      <button type="button" onClick={() => void refresh()}>Retry</button>
    </div>
  );
  const availability = consoleAvailability(vm, kind);
  if (!availability.ready) return (
    <div role="status">
      <p>{availability.message}</p>
      <button type="button" onClick={() => void refresh()}>Refresh status</button>
    </div>
  );
  return <>{children}</>;
}
