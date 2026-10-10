"use client";

import { useMemo, useState } from "react";
import {
  canOpenConsole,
  filterVms,
  isBusyStatus,
  isRunning,
  isStopped,
  statusLabel,
  type VM,
  type VmAction,
} from "../vm";

interface VMListProps {
  vms: VM[];
  loading: boolean;
  error: string | null;
  selectedUUID: string | null;
  busyUuid: string | null;
  onSelectVM: (uuid: string) => void;
  onAction: (uuid: string, action: VmAction) => void;
  onRetry: () => void;
}

const statusClass = (status: string): string => {
  if (canOpenConsole(status) && status.toLowerCase() !== "paused") return "is-running";
  if (status.toLowerCase() === "paused") return "is-paused";
  if (isBusyStatus(status)) return "is-busy";
  if (isStopped(status)) return "is-stopped";
  return "is-unknown";
};

const VMList = ({
  vms,
  loading,
  error,
  selectedUUID,
  busyUuid,
  onSelectVM,
  onAction,
  onRetry,
}: VMListProps) => {
  const [query, setQuery] = useState("");
  const visible = useMemo(() => filterVms(vms, query), [vms, query]);
  const runningCount = vms.filter((vm) => isRunning(vm.Status)).length;

  return (
    <div className="vm-list">
      <div className="vm-list-search">
        <i className="bi bi-search" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search name or UUID"
          aria-label="Search virtual machines"
        />
      </div>
      <div className="vm-list-meta">
        {loading
          ? "Loading virtual machines"
          : `${vms.length} virtual machine${vms.length === 1 ? "" : "s"} · ${runningCount} running`}
      </div>

      {error && (
        <div className="vm-list-banner" role="alert">
          <p>{error}</p>
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        </div>
      )}

      <div className="vm-list-items">
        {loading && vms.length === 0 && <p className="vm-list-empty">Loading virtual machines…</p>}
        {!loading && vms.length === 0 && !error && (
          <p className="vm-list-empty">No virtual machines yet.</p>
        )}
        {!loading && vms.length > 0 && visible.length === 0 && (
          <p className="vm-list-empty">No virtual machines match that search.</p>
        )}
        {visible.map((vm) => {
          const selected = vm.UUID === selectedUUID;
          const busy = busyUuid === vm.UUID || isBusyStatus(vm.Status);
          return (
            <div key={vm.UUID} className={`vm-row ${selected ? "is-selected" : ""}`}>
              <button
                type="button"
                className="vm-row-main"
                onClick={() => onSelectVM(vm.UUID)}
                aria-current={selected ? "true" : undefined}
              >
                <span className={`status-dot ${statusClass(vm.Status)}`} aria-hidden="true" />
                <span className="vm-row-text">
                  <span className="vm-row-name">{vm.Name}</span>
                  <span className="vm-row-status">{statusLabel(vm.Status)}</span>
                </span>
              </button>
              {isStopped(vm.Status) && (
                <button
                  type="button"
                  className="icon-button"
                  title={`Start ${vm.Name}`}
                  aria-label={`Start ${vm.Name}`}
                  disabled={busy}
                  onClick={() => onAction(vm.UUID, "start")}
                >
                  <i className={`bi ${busy ? "bi-arrow-clockwise spin" : "bi-play-fill"}`} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default VMList;
