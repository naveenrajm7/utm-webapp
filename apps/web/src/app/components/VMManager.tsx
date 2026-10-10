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
  const { vms, loading, error, busyUuid, actionError, refresh, runAction, dismissActionError } =
    useVmList();
  const [selectedUUID, setSelectedUUID] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const selected = vms.find((vm) => vm.UUID === selectedUUID) ?? null;

  useEffect(() => {
    if (selectedUUID && !loading && vms.length > 0 && !vms.some((vm) => vm.UUID === selectedUUID)) {
      setSelectedUUID(null);
    }
  }, [loading, selectedUUID, vms]);

  useEffect(() => {
    document.title = selected ? `${selected.Name} · UTM Web` : "UTM Web";
  }, [selected]);

  const selectVM = (uuid: string) => {
    setSelectedUUID(uuid);
    setSidebarOpen(false);
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <button
          type="button"
          className="icon-button sidebar-toggle"
          aria-label={sidebarOpen ? "Close virtual machine list" : "Open virtual machine list"}
          aria-expanded={sidebarOpen}
          onClick={() => setSidebarOpen((open) => !open)}
        >
          <i className={`bi ${sidebarOpen ? "bi-x-lg" : "bi-list"}`} />
        </button>
        <button type="button" className="brand-button" onClick={() => setSelectedUUID(null)}>
          UTM Web
        </button>
        {selected && (
          <div className="header-vm">
            <span className="header-vm-name">{selected.Name}</span>
            <span className="header-vm-status">{statusLabel(selected.Status)}</span>
          </div>
        )}
        {selected && (
          <VMActionControls
            vmName={selected.Name}
            vmUUID={selected.UUID}
            status={selected.Status}
            busy={busyUuid === selected.UUID}
            onAction={runAction}
          />
        )}
        <button type="button" className="icon-button lock-button" onClick={clearApiKey} title="Lock" aria-label="Lock">
          <i className="bi bi-lock" />
        </button>
      </header>

      {actionError && (
        <div className="action-error" role="alert">
          <span>{actionError}</span>
          <button type="button" onClick={dismissActionError} aria-label="Dismiss">
            <i className="bi bi-x-lg" />
          </button>
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
            selectedUUID={selectedUUID}
            busyUuid={busyUuid}
            onSelectVM={selectVM}
            onAction={runAction}
            onRetry={() => {
              void refresh();
            }}
          />
        </aside>
        <main className="workspace-main">
          {selected ? (
            <VMInfo
              uuid={selected.UUID}
              name={selected.Name}
              status={selected.Status}
              busy={busyUuid === selected.UUID}
              onAction={runAction}
            />
          ) : (
            <WelcomeScreen />
          )}
        </main>
      </div>
    </div>
  );
}
