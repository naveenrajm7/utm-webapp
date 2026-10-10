"use client";

import { useEffect, useState } from "react";
import { apiFetch, getAuthenticatedWebSocketUrl } from "../apiAuth";
import {
  canOpenConsole,
  formatMemory,
  isBusyStatus,
  serialAvailability,
  statusLabel,
  summarizeList,
  type VmAction,
} from "../vm";
import VNCViewer from "./VNCViewer";
import XTerminal from "./xterminal";

interface VMInfoProps {
  uuid: string;
  name: string;
  status: string;
  busy: boolean;
  onAction: (uuid: string, action: VmAction) => void;
}

interface VMDetails {
  Architecture?: string;
  Machine?: string;
  Memory?: number;
  SerialPorts?: unknown;
  Drives?: unknown;
  NetworkInterfaces?: unknown;
}

type TabId = "display" | "serial" | "details";

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: "display", label: "Display", icon: "bi-display" },
  { id: "serial", label: "Serial", icon: "bi-terminal" },
  { id: "details", label: "Details", icon: "bi-info-circle" },
];

const VMInfo = ({ uuid, name, status, busy, onAction }: VMInfoProps) => {
  const [tab, setTab] = useState<TabId>("display");
  const [details, setDetails] = useState<VMDetails | null>(null);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setTab("display");
    setDetails(null);
    setDetailsError(null);
    setDetailsLoading(true);

    let cancelled = false;
    apiFetch(`/vm_info?uuid=${encodeURIComponent(uuid)}`)
      .then(async (response) => {
        const data: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const message =
            data && typeof data === "object" && "message" in data && typeof data.message === "string"
              ? data.message
              : "Could not load virtual machine details";
          throw new Error(message);
        }
        return data as VMDetails;
      })
      .then((data) => {
        if (!cancelled) setDetails(data);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setDetailsError(error instanceof Error ? error.message : "Could not load virtual machine details");
        }
      })
      .finally(() => {
        if (!cancelled) setDetailsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [uuid]);

  const serial = serialAvailability(details?.SerialPorts);
  const consoleReady = canOpenConsole(status);
  const transitioning = busy || isBusyStatus(status);

  const renderGate = (kind: "display" | "serial") => {
    if (transitioning && !consoleReady) {
      return (
        <div className="vm-pane-message">
          <p>{statusLabel(status)} {name}…</p>
        </div>
      );
    }

    if (!consoleReady) {
      return (
        <div className="vm-pane-message">
          <p>Start {name} to open the {kind === "display" ? "display" : "serial console"}.</p>
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => onAction(uuid, "start")}
          >
            Start virtual machine
          </button>
        </div>
      );
    }

    if (kind === "serial" && detailsLoading) {
      return (
        <div className="vm-pane-message">
          <p>Checking serial ports…</p>
        </div>
      );
    }

    if (kind === "serial" && !detailsLoading && !serial.available) {
      return (
        <div className="vm-pane-message">
          <p>{serial.text}</p>
        </div>
      );
    }

    return null;
  };

  return (
    <section className="vm-workspace" aria-label={name}>
      <div className="vm-tabs" role="tablist" aria-label="Virtual machine views">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`tab-${item.id}`}
            aria-selected={tab === item.id}
            aria-controls={`panel-${item.id}`}
            className={tab === item.id ? "is-selected" : ""}
            onClick={() => setTab(item.id)}
          >
            <i className={`bi ${item.icon}`} aria-hidden="true" />
            {item.label}
          </button>
        ))}
      </div>

      {tab === "display" && (
        <div className="vm-pane" role="tabpanel" id="panel-display" aria-labelledby="tab-display">
          {renderGate("display") ?? (
            <VNCViewer url={getAuthenticatedWebSocketUrl("/vnc", { vmUUID: uuid })} />
          )}
        </div>
      )}

      {tab === "serial" && (
        <div className="vm-pane" role="tabpanel" id="panel-serial" aria-labelledby="tab-serial">
          {renderGate("serial") ?? <XTerminal vmUUID={uuid} />}
        </div>
      )}

      {tab === "details" && (
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
              <dd>{statusLabel(status)}</dd>
            </div>
            <div>
              <dt>Architecture</dt>
              <dd>{details?.Architecture || "Unknown"}</dd>
            </div>
            <div>
              <dt>Machine</dt>
              <dd>{details?.Machine || "Unknown"}</dd>
            </div>
            <div>
              <dt>Memory</dt>
              <dd>{formatMemory(details?.Memory)}</dd>
            </div>
            <div>
              <dt>Serial</dt>
              <dd>{detailsLoading ? "Loading" : serial.text}</dd>
            </div>
            <div>
              <dt>Drives</dt>
              <dd>{summarizeList(details?.Drives, "No drives")}</dd>
            </div>
            <div>
              <dt>Network</dt>
              <dd>{summarizeList(details?.NetworkInterfaces, "No network interfaces")}</dd>
            </div>
            <div>
              <dt>UUID</dt>
              <dd className="vm-uuid">
                <code>{uuid}</code>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    void navigator.clipboard.writeText(uuid).then(
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
