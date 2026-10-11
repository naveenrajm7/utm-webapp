"use client";

import { useEffect, useState } from "react";
import { clearApiKey } from "../apiAuth";
import { IS_DEMO } from "../demo";
import { useVmList } from "../useVmList";
import { statusLabel } from "../vm";
import VMActionControls from "./VMActionControls";
import { AppIcon } from "./VMIcon";
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
    refresh,
    runAction,
    dismissActionError,
  } = useVmList();
  const [selectedUUID, setSelectedUUID] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const selected = vms.find((vm) => vm.id === selectedUUID) ?? null;

  useEffect(() => {
    if (selectedUUID && !loading && !vms.some((vm) => vm.id === selectedUUID)) {
      setSelectedUUID(null);
    }
  }, [loading, selectedUUID, vms]);

  useEffect(() => {
    document.title = selected ? `${selected.name} · UTM Web` : "UTM Web";
  }, [selected]);

  const selectVM = (uuid: string) => {
    setSelectedUUID(uuid);
    setSidebarOpen(false);
  };

  return (
    <div className="app-shell">
      {sidebarOpen && (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Close virtual machine list"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside className={`sidebar ${sidebarOpen ? "is-open" : ""}`}>
        <div className="sidebar-titlebar">
          <button
            type="button"
            className="brand-button"
            onClick={() => {
              setSelectedUUID(null);
              setSidebarOpen(false);
            }}
          >
            <AppIcon size={22} />
            UTM Web
          </button>
        </div>
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

      <div className="app-main">
        <header className="toolbar">
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
            <i className="bi bi-layout-sidebar" />
          </button>
          <div className="toolbar-title">
            <span className="toolbar-title-name">
              {selected ? selected.name : "UTM Web"}
            </span>
            {selected && (
              <span className="toolbar-title-status">
                {statusLabel(selected.status)}
              </span>
            )}
          </div>
          {IS_DEMO && (
            <span
              className="demo-badge"
              title="Virtual machines in this preview are simulated"
            >
              Preview
            </span>
          )}
          {selected && (
            <VMActionControls
              vm={selected}
              busy={busyUuid !== null}
              onAction={runAction}
            />
          )}
          {!IS_DEMO && (
            <button
              type="button"
              className="icon-button lock-button"
              onClick={clearApiKey}
              title="Lock"
              aria-label="Lock"
            >
              <i className="bi bi-lock" />
            </button>
          )}
        </header>

        {actionError && (
          <div className="action-error" role="alert">
            <i className="bi bi-exclamation-triangle-fill" aria-hidden="true" />
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
            <i className="bi bi-arrow-clockwise spin" aria-hidden="true" />
            {actionJob.action === "start" ? "Starting" : "Stopping"} virtual
            machine · {actionJob.state}
          </div>
        )}

        <main className="workspace-main">
          {selected && (
            <VMInfo
              vm={selected}
              busy={busyUuid !== null}
              onAction={runAction}
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
