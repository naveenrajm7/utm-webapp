"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getJob, jobError, listVms, powerVm, type Job } from "./v1";
import { friendlyListError, hasCapability, type VM, type VmAction } from "./vm";

const POLL_MS = 5000;

interface VmListState {
  vms: VM[];
  loading: boolean;
  error: string | null;
  busyUuid: string | null;
  actionError: string | null;
  actionJob: { action: VmAction; state: Job["state"] } | null;
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
  const [pending, setPending] = useState<{
    id: string;
    action: VmAction;
    state: Job["state"];
  } | null>(null);
  const inFlight = useRef(false);
  const powerInFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current || powerInFlight.current) return;
    inFlight.current = true;
    try {
      const data = await listVms();
      if (!Array.isArray(data))
        throw new Error("The API returned an invalid VM list.");
      setVms(data);
      setError(null);
    } catch (caught) {
      setError(
        friendlyListError(
          caught instanceof Error
            ? caught.message
            : "Failed to list virtual machines",
        ),
      );
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!pending) return;
    let checking = false;
    const check = async () => {
      if (checking) return;
      checking = true;
      try {
        const job = await getJob(pending.id);
        if (job.state === "failed") {
          setActionError(jobError(job));
          setPending(null);
          setBusyUuid(null);
          powerInFlight.current = false;
          void refresh();
        } else if (job.state === "succeeded") {
          setPending(null);
          setBusyUuid(null);
          powerInFlight.current = false;
          void refresh();
        } else {
          setPending((current) =>
            current?.id === pending.id
              ? { ...current, state: job.state }
              : current,
          );
        }
      } catch (caught) {
        setActionError(
          caught instanceof Error
            ? caught.message
            : "Could not check the VM job",
        );
        setPending(null);
        setBusyUuid(null);
        powerInFlight.current = false;
      } finally {
        checking = false;
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 2000);
    return () => window.clearInterval(timer);
  }, [pending?.id, refresh]);

  const runAction = useCallback(
    async (uuid: string, action: VmAction) => {
      if (busyUuid) return;
      const vm = vms.find((item) => item.id === uuid);
      if (!vm || !hasCapability(vm, action)) return;
      setActionError(null);
      setBusyUuid(uuid);
      powerInFlight.current = true;
      try {
        const result = await powerVm(uuid, action);
        if (!result.jobId) throw new Error("The API did not return a job ID.");
        setPending({ id: result.jobId, action, state: "queued" });
      } catch (caught) {
        setActionError(
          caught instanceof Error
            ? caught.message
            : `Could not ${action} the virtual machine`,
        );
        setBusyUuid(null);
        powerInFlight.current = false;
        void refresh();
      }
    },
    [busyUuid, refresh, vms],
  );

  return {
    vms,
    loading,
    error,
    busyUuid,
    actionError,
    actionJob: pending
      ? { action: pending.action, state: pending.state }
      : null,
    refresh,
    runAction,
    dismissActionError: () => setActionError(null),
  };
};
