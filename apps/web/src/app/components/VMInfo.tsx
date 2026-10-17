"use client";

import { useEffect, useState } from "react";
import { getAuthenticatedWebSocketUrl } from "../apiAuth";
import {
  backendLabel,
  canOpenConsole,
  formatCpuCores,
  formatMemory,
  hasCapability,
  isBusyStatus,
  isStopped,
  networkLabel,
  serialAvailability,
  statusLabel,
  summarizeList,
  type VM,
  type VmAction,
} from "../vm";
import VMManagementControls from "./VMManagementControls";
import type { VmOperation } from "../vmStore";
import VNCViewer from "./VNCViewer";
import XTerminal from "./xterminal";

interface VMInfoProps {
  vm: VM;
  busy: boolean;
  onAction: (uuid: string, action: VmAction) => void;
  onManagement?: (uuid: string, operation: VmOperation) => void;
  detailsLoading: boolean;
  detailsError: string | null;
}

type ConsoleView = "display" | "serial";
type View = "details" | ConsoleView;

const DetailRow = ({
  icon,
  label,
  children,
}: {
  icon: string;
  label: string;
  children: React.ReactNode;
}) => (
  <div>
    <dt>
      <i className={`bi ${icon}`} aria-hidden="true" />
      {label}
    </dt>
    <dd>{children}</dd>
  </div>
);

const VMInfo = ({
  vm,
  busy,
  onAction,
  onManagement,
  detailsLoading,
  detailsError,
}: VMInfoProps) => {
  const [view, setView] = useState<View>("details");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setView("details");
  }, [vm.id]);

  const serial = hasCapability(vm, "serial")
    ? {
        available: true,
        text:
          vm.serialPorts == null
            ? "Configured"
            : serialAvailability(vm.serialPorts).available
              ? serialAvailability(vm.serialPorts).text
              : "Configured",
      }
    : { available: false, text: "Unavailable" };
  const consoleReady = canOpenConsole(vm.status);
  const transitioning = busy || isBusyStatus(vm.status);
  const consoles: { id: ConsoleView; label: string; icon: string }[] = [
    ...(hasCapability(vm, "display")
      ? [{ id: "display" as const, label: "Display", icon: "bi-display" }]
      : []),
    ...(hasCapability(vm, "serial")
      ? [{ id: "serial" as const, label: "Serial", icon: "bi-terminal" }]
      : []),
  ];
  const views: { id: View; label: string; icon: string }[] = [
    { id: "details", label: "Details", icon: "bi-info-circle" },
    ...consoles,
  ];
  const activeView: View = views.some((item) => item.id === view)
    ? view
    : "details";
  const canRun = isStopped(vm.status) && hasCapability(vm, "start");

  const runAndOpen = () => {
    onAction(vm.id, "start");
    if (consoles[0]) setView(consoles[0].id);
  };

  const renderGate = (kind: ConsoleView) => {
    if (transitioning) {
      return (
        <div className="vm-pane-message">
          <i className="bi bi-arrow-clockwise spin" aria-hidden="true" />
          <p>
            {busy ? "Updating" : statusLabel(vm.status)} {vm.name}…
          </p>
        </div>
      );
    }
    if (!consoleReady) {
      return (
        <div className="vm-pane-message">
          {canRun && (
            <button
              type="button"
              className="screen-play"
              disabled={busy}
              onClick={() => onAction(vm.id, "start")}
              aria-label="Start virtual machine"
              title="Start virtual machine"
            >
              <i className="bi bi-play-fill" aria-hidden="true" />
            </button>
          )}
          <p>
            Start {vm.name} to open the{" "}
            {kind === "display" ? "display" : "serial console"}.
          </p>
        </div>
      );
    }
    return null;
  };

  const graphical = hasCapability(vm, "display");
  const serialOnly = !graphical && hasCapability(vm, "serial");
  const screenshot =
    graphical &&
    typeof vm.screenshot === "string" &&
    vm.screenshot.startsWith("data:image/png;base64,")
      ? vm.screenshot
      : undefined;
  const previewClass = graphical
    ? screenshot
      ? "vm-preview has-shot"
      : "vm-preview is-graphic"
    : serialOnly
      ? "vm-preview is-serial"
      : "vm-preview is-plain";

  const previewBody = () => {
    if (transitioning) {
      return (
        <div className="vm-preview-copy">
          <i className="bi bi-arrow-clockwise spin" aria-hidden="true" />
          <p>{busy ? "Updating" : statusLabel(vm.status)}…</p>
        </div>
      );
    }
    if (consoleReady && consoles.length > 0) {
      return (
        <div className="vm-preview-copy">
          {serialOnly && (
            <p>Serial console only. This virtual machine has no graphical display.</p>
          )}
          {consoles.map((item) => (
            <button
              key={item.id}
              type="button"
              className="screen-open"
              onClick={() => setView(item.id)}
            >
              <i className={`bi ${item.icon}`} aria-hidden="true" />
              Open {item.label}
            </button>
          ))}
        </div>
      );
    }
    if (canRun) {
      return (
        <div className="vm-preview-copy">
          <button
            type="button"
            className="screen-play"
            onClick={runAndOpen}
            disabled={busy}
            aria-label={`Run ${vm.name}`}
            title="Run"
          >
            <i className="bi bi-play-fill" aria-hidden="true" />
          </button>
          {serialOnly ? (
            <p>Serial console only. This virtual machine has no graphical display.</p>
          ) : graphical && !screenshot ? (
            <p>No saved preview.</p>
          ) : null}
        </div>
      );
    }
    return (
      <div className="vm-preview-copy">
        <p>
          {serialOnly
            ? "Serial console only. This virtual machine has no graphical display."
            : consoleReady
              ? "This virtual machine has no browser console. Use it in the UTM window on your Mac."
              : `${statusLabel(vm.status)}.`}
        </p>
      </div>
    );
  };

  const details = (
    <div className="vm-detail">
      <div className={previewClass}>
        {screenshot && (
          // Saved frames arrive as data URLs, which the image optimizer cannot fetch.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="vm-preview-image"
            src={screenshot}
            alt={`Saved preview of ${vm.name}`}
          />
        )}
        {previewBody()}
      </div>

      {onManagement && <VMManagementControls key={vm.id} vm={vm} busy={transitioning} onSubmit={onManagement} />}

      <div className="group-box">
          <h2>Details</h2>
          {detailsLoading && <p className="vm-list-empty">Loading details…</p>}
          {detailsError && (
            <p className="vm-list-banner" role="alert">
              {detailsError}
            </p>
          )}
          <dl className="vm-spec">
            <DetailRow icon="bi-power" label="Status">
              {statusLabel(vm.status)}
            </DetailRow>
            <DetailRow icon="bi-boxes" label="Backend">
              {backendLabel(vm.backend)}
            </DetailRow>
            {vm.architecture && (
              <DetailRow icon="bi-cpu" label="Architecture">
                {vm.architecture}
              </DetailRow>
            )}
            {vm.machine && (
              <DetailRow icon="bi-motherboard" label="Machine">
                {vm.machine}
              </DetailRow>
            )}
            <DetailRow icon="bi-memory" label="Memory">
              {formatMemory(vm.memoryMiB)}
            </DetailRow>
            <DetailRow icon="bi-grid-3x3-gap" label="CPU cores">
              {formatCpuCores(vm.cpuCores)}
            </DetailRow>
            {vm.drives != null && (
              <DetailRow icon="bi-hdd" label="Drives">
                {summarizeList(vm.drives, "No drives")}
              </DetailRow>
            )}
            <DetailRow icon="bi-globe" label="Network">
              {networkLabel(vm)}
            </DetailRow>
            <DetailRow icon="bi-terminal" label="Serial">
              {serial.text}
            </DetailRow>
            <DetailRow icon="bi-fingerprint" label="UUID">
              <span className="vm-uuid">
                <code>{vm.id}</code>
                <button
                  type="button"
                  className="push-button"
                  onClick={() => {
                    void navigator.clipboard.writeText(vm.id).then(
                      () => {
                        setCopied(true);
                        window.setTimeout(() => setCopied(false), 1500);
                      },
                      () => setCopied(false),
                    );
                  }}
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </span>
            </DetailRow>
          </dl>
        </div>
    </div>
  );

  return (
    <section className="vm-window" aria-label={vm.name}>
      {consoles.length > 0 && (
        <div className="vm-window-toolbar">
          <div
            className="segmented"
            role="tablist"
            aria-label="Virtual machine views"
          >
            {views.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                id={`tab-${item.id}`}
                aria-selected={activeView === item.id}
                aria-controls={`panel-${item.id}`}
                className={activeView === item.id ? "is-selected" : ""}
                onClick={() => setView(item.id)}
              >
                <i className={`bi ${item.icon}`} aria-hidden="true" />
                {item.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <div
        className={activeView === "details" ? "vm-detail-pane" : "vm-pane"}
        role="tabpanel"
        id={`panel-${activeView}`}
        aria-labelledby={`tab-${activeView}`}
      >
        {activeView === "details"
          ? details
          : activeView === "display"
            ? (renderGate("display") ?? (
                <VNCViewer
                  url={getAuthenticatedWebSocketUrl("/ws/vnc", { vmUUID: vm.id })}
                />
              ))
            : (renderGate("serial") ?? <XTerminal vmUUID={vm.id} />)}
      </div>
    </section>
  );
};

export default VMInfo;
