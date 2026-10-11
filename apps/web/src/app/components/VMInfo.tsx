"use client";

import { useEffect, useState } from "react";
import { getAuthenticatedWebSocketUrl } from "../apiAuth";
import { consolePath } from "../demo";
import { getVm } from "../v1";
import {
  backendLabel,
  canOpenConsole,
  formatMemory,
  hasCapability,
  isBusyStatus,
  isStopped,
  serialAvailability,
  statusLabel,
  statusTone,
  summarizeList,
  type VM,
  type VmAction,
} from "../vm";
import VMIcon from "./VMIcon";
import VNCViewer from "./VNCViewer";
import XTerminal from "./xterminal";

interface VMInfoProps {
  vm: VM;
  busy: boolean;
  onAction: (uuid: string, action: VmAction) => void;
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

const VMInfo = ({ vm, busy, onAction }: VMInfoProps) => {
  const [view, setView] = useState<View>("details");
  const [details, setDetails] = useState<VM | null>(null);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setView("details");
    setDetails(null);
    setDetailsError(null);
    setDetailsLoading(true);
    let cancelled = false;
    getVm(vm.id)
      .then((data) => {
        if (!cancelled) setDetails(data);
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setDetailsError(
            error instanceof Error
              ? error.message
              : "Could not load virtual machine details",
          );
      })
      .finally(() => {
        if (!cancelled) setDetailsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [vm.id]);

  const current =
    details && details.id === vm.id
      ? { ...vm, ...details, status: vm.status }
      : vm;
  const serial =
    current.serialPorts == null
      ? {
          available: hasCapability(current, "serial"),
          text: hasCapability(current, "serial")
            ? "Available"
            : current.backend === "qemu"
              ? "Not reported"
              : "Unavailable",
        }
      : serialAvailability(current.serialPorts);
  const consoleReady = canOpenConsole(vm.status);
  const transitioning = busy || isBusyStatus(vm.status);
  const consoles: { id: ConsoleView; label: string; icon: string }[] = [
    ...(hasCapability(current, "display")
      ? [{ id: "display" as const, label: "Display", icon: "bi-display" }]
      : []),
    ...(hasCapability(current, "serial")
      ? [{ id: "serial" as const, label: "Serial", icon: "bi-terminal" }]
      : []),
  ];
  const primaryConsole = consoles[0]?.id;
  const activeView: View = consoles.some((item) => item.id === view)
    ? view
    : "details";

  const runAndOpen = () => {
    onAction(vm.id, "start");
    if (primaryConsole) setView(primaryConsole);
  };

  const renderGate = (kind: ConsoleView) => {
    if (transitioning && !consoleReady) {
      return (
        <div className="vm-pane-message">
          <i className="bi bi-arrow-clockwise spin" aria-hidden="true" />
          <p>
            {statusLabel(vm.status)} {vm.name}…
          </p>
        </div>
      );
    }
    if (!consoleReady) {
      return (
        <div className="vm-pane-message">
          {hasCapability(current, "start") && isStopped(vm.status) && (
            <button
              type="button"
              className="screen-play"
              disabled={busy}
              onClick={() => onAction(vm.id, "start")}
              aria-label={`Start ${vm.name}`}
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
    if (kind === "serial" && !serial.available) {
      return (
        <div className="vm-pane-message">
          <p>{serial.text}</p>
        </div>
      );
    }
    return null;
  };

  if (activeView !== "details") {
    return (
      <section className="vm-window" aria-label={`${vm.name} console`}>
        <div className="vm-window-toolbar">
          <button
            type="button"
            className="toolbar-chip"
            onClick={() => setView("details")}
          >
            <i className="bi bi-chevron-left" aria-hidden="true" />
            Details
          </button>
          {consoles.length > 1 && (
            <div
              className="segmented"
              role="tablist"
              aria-label="Virtual machine views"
            >
              {consoles.map((item) => (
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
          )}
        </div>
        <div
          className="vm-pane"
          role="tabpanel"
          id={`panel-${activeView}`}
          aria-labelledby={`tab-${activeView}`}
        >
          {activeView === "display"
            ? (renderGate("display") ?? (
                <VNCViewer
                  url={getAuthenticatedWebSocketUrl("/vnc", { vmUUID: vm.id })}
                />
              ))
            : (renderGate("serial") ?? <XTerminal vmUUID={vm.id} />)}
        </div>
      </section>
    );
  }

  const canRun = isStopped(vm.status) && hasCapability(current, "start");

  return (
    <section className="vm-detail" aria-label={vm.name}>
      <header className="vm-detail-header">
        <VMIcon vm={current} size="large" />
        <div>
          <h1>{vm.name}</h1>
          <p>
            <span
              className={`status-dot ${statusTone(vm.status)}`}
              aria-hidden="true"
            />
            {statusLabel(vm.status)} · {backendLabel(current.backend)}
          </p>
        </div>
      </header>

      <div className="vm-detail-grid">
        <div className="vm-screen">
          {transitioning ? (
            <div className="vm-screen-content">
              <i className="bi bi-arrow-clockwise spin" aria-hidden="true" />
              <p>{statusLabel(vm.status)}…</p>
            </div>
          ) : consoleReady && consoles.length > 0 ? (
            <div className="vm-screen-content">
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
          ) : canRun ? (
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
          ) : (
            <div className="vm-screen-content">
              <p>
                {consoleReady
                  ? "This virtual machine has no browser console. Use it in the UTM window on your Mac."
                  : `${vm.name} is ${statusLabel(vm.status).toLowerCase()}.`}
              </p>
            </div>
          )}
        </div>

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
              {backendLabel(current.backend)}
            </DetailRow>
            {current.architecture && (
              <DetailRow icon="bi-cpu" label="Architecture">
                {current.architecture}
              </DetailRow>
            )}
            {current.machine && (
              <DetailRow icon="bi-motherboard" label="Machine">
                {current.machine}
              </DetailRow>
            )}
            <DetailRow icon="bi-memory" label="Memory">
              {formatMemory(current.memoryMiB)}
            </DetailRow>
            <DetailRow icon="bi-grid-3x3-gap" label="CPU cores">
              {current.cpuCores ?? "Unknown"}
            </DetailRow>
            {current.drives != null && (
              <DetailRow icon="bi-hdd" label="Drives">
                {summarizeList(current.drives, "No drives")}
              </DetailRow>
            )}
            <DetailRow icon="bi-globe" label="Network">
              {current.network ||
                summarizeList(current.networkInterfaces, "Unknown")}
            </DetailRow>
            <DetailRow icon="bi-terminal" label="Serial">
              {serial.text}
            </DetailRow>
            {current.backend === "qemu" &&
              (!hasCapability(current, "serial") ||
                !hasCapability(current, "display")) && (
                <DetailRow icon="bi-plug" label="Consoles">
                  <span className="console-try-links">
                    {!hasCapability(current, "serial") && (
                      <a
                        className="push-button"
                        href={consolePath("terminal", vm.id)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Try serial console
                      </a>
                    )}
                    {!hasCapability(current, "display") && (
                      <a
                        className="push-button"
                        href={consolePath("vnc", vm.id)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Try VNC display
                      </a>
                    )}
                    <span>Availability has not been confirmed for this VM.</span>
                  </span>
                </DetailRow>
              )}
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
    </section>
  );
};

export default VMInfo;
