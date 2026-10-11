"use client";

import { useMemo, useState } from "react";
import {
  filterVms,
  hasCapability,
  isBusyStatus,
  isRunning,
  isStopped,
  statusLabel,
  statusTone,
  type VM,
  type VmAction,
} from "../vm";
import VMIcon from "./VMIcon";

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
  const runningCount = vms.filter((vm) => isRunning(vm.status)).length;

  return (
    <div className="vm-list">
      <div className="vm-list-search">
        <i className="bi bi-search" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search"
          aria-label="Search virtual machines"
        />
      </div>

      {error && (
        <div className="vm-list-banner" role="alert">
          <p>{error}</p>
          <button type="button" className="push-button" onClick={onRetry}>
            Retry
          </button>
        </div>
      )}

      <div className="vm-list-items">
        <div className="sidebar-section">
          <span>Virtual Machines</span>
          {!loading && (
            <span className="sidebar-section-count">
              {runningCount > 0 ? `${runningCount} running` : vms.length}
            </span>
          )}
        </div>
        {loading && vms.length === 0 && (
          <p className="vm-list-empty">Loading virtual machines…</p>
        )}
        {!loading && vms.length === 0 && !error && (
          <p className="vm-list-empty">No virtual machines yet.</p>
        )}
        {!loading && vms.length > 0 && visible.length === 0 && (
          <p className="vm-list-empty">
            No virtual machines match that search.
          </p>
        )}
        {visible.map((vm) => {
          const selected = vm.id === selectedUUID;
          const busy = busyUuid !== null || isBusyStatus(vm.status);
          return (
            <div
              key={vm.id}
              className={`vm-row ${selected ? "is-selected" : ""}`}
            >
              <button
                type="button"
                className="vm-row-main"
                onClick={() => onSelectVM(vm.id)}
                aria-current={selected ? "true" : undefined}
              >
                <VMIcon vm={vm} />
                <span className="vm-row-text">
                  <span className="vm-row-name">{vm.name}</span>
                  <span className="vm-row-status">
                    <span
                      className={`status-dot ${statusTone(vm.status)}`}
                      aria-hidden="true"
                    />
                    {statusLabel(vm.status)}
                  </span>
                </span>
              </button>
              {isStopped(vm.status) && hasCapability(vm, "start") && (
                <button
                  type="button"
                  className="vm-row-run"
                  title={`Start ${vm.name}`}
                  aria-label={`Start ${vm.name}`}
                  disabled={busy}
                  onClick={() => onAction(vm.id, "start")}
                >
                  <i
                    className={`bi ${busy ? "bi-arrow-clockwise spin" : "bi-play-fill"}`}
                  />
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
