"use client";

import { useEffect, useState } from "react";
import { clearApiKey } from "../apiAuth";
import { useVmList } from "../useVmList";
import { statusLabel } from "../vm";
import VMActionControls from "./VMActionControls";
import VMInfo from "./VMInfo";
import VMList from "./VMList";
import WelcomeScreen from "./WelcomeScreen";

export default function VMManager() {
  const {
    vms,
    loading,
    error,
    busyUuid,
    actionError,
    actionJob,
    selectedId,
    selected,
    detailsLoading,
    detailsError,
    refresh,
    runAction,
    select,
    dismissActionError,
  } = useVmList();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    document.title = selected ? `${selected.name} · UTM Web` : "UTM Web";
  }, [selected]);

  const selectVM = (uuid: string) => {
    select(uuid);
    setSidebarOpen(false);
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <button
          type="button"
          className="icon-button sidebar-toggle"
          aria-label={
            sidebarOpen
              ? "Close virtual machine list"
              : "Open virtual machine list"
          }
          aria-expanded={sidebarOpen}
          onClick={() => setSidebarOpen((open) => !open)}
        >
          <i className={`bi ${sidebarOpen ? "bi-x-lg" : "bi-list"}`} />
        </button>
        <button
          type="button"
          className="brand-button"
          onClick={() => select(null)}
        >
          UTM Web
        </button>
        {selected && (
          <div className="header-vm">
            <span className="header-vm-name">{selected.name}</span>
            <span className="header-vm-status">
              {statusLabel(selected.status)}
            </span>
          </div>
        )}
        {selected && (
          <VMActionControls
            vm={selected}
            busy={busyUuid !== null}
            onAction={runAction}
          />
        )}
        <button
          type="button"
          className="icon-button lock-button"
          onClick={clearApiKey}
          title="Lock"
          aria-label="Lock"
        >
          <i className="bi bi-lock" />
        </button>
      </header>

      {actionError && (
        <div className="action-error" role="alert">
          <span>{actionError}</span>
          <button
            type="button"
            onClick={dismissActionError}
            aria-label="Dismiss"
          >
            <i className="bi bi-x-lg" />
          </button>
        </div>
      )}
      {actionJob && (
        <div className="vm-job-status" role="status">
          VM {actionJob.action} job · {actionJob.state}
        </div>
      )}

      <div className="app-body">
        {sidebarOpen && (
          <button
            type="button"
            className="sidebar-backdrop"
            aria-label="Close virtual machine list"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <aside className={`sidebar ${sidebarOpen ? "is-open" : ""}`}>
          <VMList
            vms={vms}
            loading={loading}
            error={error}
            selectedUUID={selectedId}
            busyUuid={busyUuid}
            onSelectVM={selectVM}
            onAction={runAction}
            onRetry={() => {
              void refresh();
            }}
          />
        </aside>
        <main className="workspace-main">
          {selected && (
            <VMInfo
              vm={selected}
              busy={busyUuid !== null}
              onAction={runAction}
              detailsLoading={detailsLoading}
              detailsError={detailsError}
            />
          )}
          <div className="home-dashboard" hidden={Boolean(selected)}>
            <WelcomeScreen />
          </div>
        </main>
      </div>
    </div>
  );
}
