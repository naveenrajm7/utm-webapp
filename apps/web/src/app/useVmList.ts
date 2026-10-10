"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "./apiAuth";
import { friendlyListError, type VM, type VmAction } from "./vm";

const POLL_MS = 5000;

interface VmListState {
  vms: VM[];
  loading: boolean;
  error: string | null;
  busyUuid: string | null;
  actionError: string | null;
  refresh: () => Promise<void>;
  runAction: (uuid: string, action: VmAction) => Promise<void>;
  dismissActionError: () => void;
}

export const useVmList = (): VmListState => {
  const [vms, setVms] = useState<VM[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyUuid, setBusyUuid] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;

    try {
      const response = await apiFetch("/list_vms");
      const data: unknown = await response.json().catch(() => null);

      if (!response.ok || !Array.isArray(data)) {
        const message =
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "Failed to list virtual machines";
        throw new Error(message);
      }

      setVms(data as VM[]);
      setError(null);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Failed to list virtual machines";
      setError(friendlyListError(message));
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    }, POLL_MS);

    return () => window.clearInterval(timer);
  }, [refresh]);

  const runAction = useCallback(
    async (uuid: string, action: VmAction) => {
      setActionError(null);
      setBusyUuid(uuid);

      try {
        const response = await apiFetch(`/${action}?uuid=${encodeURIComponent(uuid)}`, {
          method: "POST",
        });
        const data: unknown = await response.json().catch(() => null);
        const record =
          data && typeof data === "object" ? (data as { message?: string; vmStatus?: string }) : {};

        if (!response.ok) {
          throw new Error(record.message || `Could not ${action} the virtual machine`);
        }

        if (record.vmStatus) {
          setVms((current) =>
            current.map((vm) => (vm.UUID === uuid ? { ...vm, Status: record.vmStatus as string } : vm)),
          );
        }
      } catch (caught) {
        const message =
          caught instanceof Error ? caught.message : `Could not ${action} the virtual machine`;
        setActionError(message);
      } finally {
        setBusyUuid(null);
        inFlight.current = false;
        void refresh();
      }
    },
    [refresh],
  );

  return {
    vms,
    loading,
    error,
    busyUuid,
    actionError,
    refresh,
    runAction,
    dismissActionError: () => setActionError(null),
  };
};
