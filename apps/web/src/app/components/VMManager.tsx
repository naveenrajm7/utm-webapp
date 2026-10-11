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
    selectedId,
    selected,
    detailsLoading,
    detailsError,
    refresh,
    runAction,
    runManagement,
    select,
    dismissActionError,
  } = useVmList();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [wideLayout, setWideLayout] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(min-width: 801px)");
    const apply = () => setWideLayout(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    document.title = selected ? `${selected.name} · UTM Web` : "UTM Web";
  }, [selected]);

  const selectVM = (uuid: string) => {
    select(uuid);
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
      <aside
        className={`sidebar ${sidebarOpen ? "is-open" : ""}`}
        style={wideLayout ? { width: sidebarWidth, flexBasis: sidebarWidth } : undefined}
      >
        <div className="sidebar-titlebar">
          <button
            type="button"
            className="brand-button"
            onClick={() => {
              select(null);
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
          selectedUUID={selectedId}
          busyUuid={busyUuid}
          onSelectVM={selectVM}
          onAction={runAction}
          onRetry={() => {
            void refresh();
          }}
        />
        {wideLayout && (
          <div
            className="sidebar-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize virtual machine list"
            aria-valuemin={200}
            aria-valuemax={480}
            aria-valuenow={sidebarWidth}
            tabIndex={0}
            onPointerDown={(event) => {
              const handle = event.currentTarget;
              const startX = event.clientX;
              const startWidth = sidebarWidth;
              handle.setPointerCapture(event.pointerId);
              const move = (pointer: PointerEvent) => {
                const next = startWidth + pointer.clientX - startX;
                setSidebarWidth(Math.min(480, Math.max(200, next)));
              };
              const stop = () => {
                handle.removeEventListener("pointermove", move);
                handle.removeEventListener("pointerup", stop);
              };
              handle.addEventListener("pointermove", move);
              handle.addEventListener("pointerup", stop);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") {
                setSidebarWidth((width) => Math.min(480, width + 16));
              }
              if (event.key === "ArrowLeft") {
                setSidebarWidth((width) => Math.max(200, width - 16));
              }
            }}
          />
        )}
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
            <span className="toolbar-title-name" title={selected?.name}>
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
            {({
              start: "Starting", stop: "Force stopping", clone: "Cloning",
              configure: "Saving settings for", delete: "Deleting",
            })[actionJob.action]} virtual machine · {actionJob.state}
          </div>
        )}

        <main className="workspace-main">
          {selected && (
            <VMInfo
              vm={selected}
              busy={busyUuid !== null}
              onAction={runAction}
              onManagement={runManagement}
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
