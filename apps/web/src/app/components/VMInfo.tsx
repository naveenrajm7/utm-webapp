"use client";

import { useEffect, useState } from "react";
import { getAuthenticatedWebSocketUrl } from "../apiAuth";
import { getVm } from "../v1";
import {
  canOpenConsole,
  hasCapability,
  isBusyStatus,
  serialAvailability,
  statusLabel,
  summarizeList,
  type VM,
  type VmAction,
} from "../vm";
import VNCViewer from "./VNCViewer";
import XTerminal from "./xterminal";

interface VMInfoProps {
  vm: VM;
  busy: boolean;
  onAction: (uuid: string, action: VmAction) => void;
}

type TabId = "display" | "serial" | "details";

const VMInfo = ({ vm, busy, onAction }: VMInfoProps) => {
  const [tab, setTab] = useState<TabId>("details");
  const [details, setDetails] = useState<VM | null>(null);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setTab(
      hasCapability(vm, "display")
        ? "display"
        : hasCapability(vm, "serial")
          ? "serial"
          : "details",
    );
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
  const tabs: { id: TabId; label: string; icon: string }[] = [
    ...(hasCapability(current, "display")
      ? [{ id: "display" as const, label: "Display", icon: "bi-display" }]
      : []),
    ...(hasCapability(current, "serial")
      ? [{ id: "serial" as const, label: "Serial", icon: "bi-terminal" }]
      : []),
    { id: "details", label: "Details", icon: "bi-info-circle" },
  ];
  const activeTab = tabs.some((item) => item.id === tab) ? tab : tabs[0].id;

  const renderGate = (kind: "display" | "serial") => {
    if (transitioning && !consoleReady) {
      return (
        <div className="vm-pane-message">
          <p>
            {statusLabel(vm.status)} {vm.name}…
          </p>
        </div>
      );
    }
    if (!consoleReady) {
      return (
        <div className="vm-pane-message">
          <p>
            Start {vm.name} to open the{" "}
            {kind === "display" ? "display" : "serial console"}.
          </p>
          {hasCapability(current, "start") && (
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => onAction(vm.id, "start")}
            >
              Start virtual machine
            </button>
          )}
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

  return (
    <section className="vm-workspace" aria-label={vm.name}>
      <div
        className="vm-tabs"
        role="tablist"
        aria-label="Virtual machine views"
      >
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`tab-${item.id}`}
            aria-selected={activeTab === item.id}
            aria-controls={`panel-${item.id}`}
            className={activeTab === item.id ? "is-selected" : ""}
            onClick={() => setTab(item.id)}
          >
            <i className={`bi ${item.icon}`} aria-hidden="true" />
            {item.label}
          </button>
        ))}
      </div>
      {activeTab === "display" && (
        <div
          className="vm-pane"
          role="tabpanel"
          id="panel-display"
          aria-labelledby="tab-display"
        >
          {renderGate("display") ?? (
            <VNCViewer
              url={getAuthenticatedWebSocketUrl("/vnc", { vmUUID: vm.id })}
            />
          )}
        </div>
      )}
      {activeTab === "serial" && (
        <div
          className="vm-pane"
          role="tabpanel"
          id="panel-serial"
          aria-labelledby="tab-serial"
        >
          {renderGate("serial") ?? <XTerminal vmUUID={vm.id} />}
        </div>
      )}
      {activeTab === "details" && (
        <div
          className="vm-pane vm-pane-details"
          role="tabpanel"
          id="panel-details"
          aria-labelledby="tab-details"
        >
          {detailsLoading && <p className="vm-list-empty">Loading details…</p>}
          {detailsError && (
            <p className="vm-list-banner" role="alert">
              {detailsError}
            </p>
          )}
          <dl className="vm-spec">
            <div>
              <dt>Status</dt>
              <dd>{statusLabel(vm.status)}</dd>
            </div>
            <div>
              <dt>Backend</dt>
              <dd>{current.backend || "Unknown"}</dd>
            </div>
            {current.architecture && (
              <div>
                <dt>Architecture</dt>
                <dd>{current.architecture}</dd>
              </div>
            )}
            {current.machine && (
              <div>
                <dt>Machine</dt>
                <dd>{current.machine}</dd>
              </div>
            )}
            <div>
              <dt>Memory</dt>
              <dd>
                {current.memoryMiB == null
                  ? "Unknown"
                  : `${current.memoryMiB} MiB`}
              </dd>
            </div>
            <div>
              <dt>CPU cores</dt>
              <dd>{current.cpuCores ?? "Unknown"}</dd>
            </div>
            <div>
              <dt>Serial</dt>
              <dd>{serial.text}</dd>
            </div>
            {current.drives != null && (
              <div>
                <dt>Drives</dt>
                <dd>{summarizeList(current.drives, "No drives")}</dd>
              </div>
            )}
            <div>
              <dt>Network</dt>
              <dd>
                {current.network ||
                  summarizeList(current.networkInterfaces, "Unknown")}
              </dd>
            </div>
            {current.backend === "qemu" &&
              (!hasCapability(current, "serial") ||
                !hasCapability(current, "display")) && (
                <div>
                  <dt>Console connections</dt>
                  <dd className="console-try-links">
                    {!hasCapability(current, "serial") && (
                      <a
                        className="text-button"
                        href={`/terminal/${encodeURIComponent(vm.id)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Try serial console
                      </a>
                    )}
                    {!hasCapability(current, "display") && (
                      <a
                        className="text-button"
                        href={`/vnc/${encodeURIComponent(vm.id)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Try VNC display
                      </a>
                    )}
                    <span>
                      Availability has not been confirmed for this VM.
                    </span>
                  </dd>
                </div>
              )}
            <div>
              <dt>UUID</dt>
              <dd className="vm-uuid">
                <code>{vm.id}</code>
                <button
                  type="button"
                  className="text-button"
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
              </dd>
            </div>
          </dl>
        </div>
      )}
    </section>
  );
};

export default VMInfo;
