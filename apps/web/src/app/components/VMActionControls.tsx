"use client";

import { canOpenConsole, isBusyStatus, isStopped, type VmAction } from "../vm";

interface VMActionControlsProps {
  vmName: string;
  vmUUID: string;
  status: string;
  busy: boolean;
  onAction: (uuid: string, action: VmAction) => void;
}

const VMActionControls = ({ vmName, vmUUID, status, busy, onAction }: VMActionControlsProps) => {
  const consoleReady = canOpenConsole(status);
  const stopped = isStopped(status);
  const transitioning = busy || isBusyStatus(status);

  const openPopout = (path: string) => {
    window.open(path, "_blank", "noopener,noreferrer");
  };

  const handleStop = () => {
    if (window.confirm(`Stop ${vmName}?`)) {
      onAction(vmUUID, "stop");
    }
  };

  return (
    <div className="header-actions">
      <button
        type="button"
        className="icon-button"
        title="Open serial console in a new tab"
        aria-label="Open serial console in a new tab"
        disabled={!consoleReady}
        onClick={() => openPopout(`/terminal/${vmUUID}`)}
      >
        <i className="bi bi-terminal" />
      </button>
      <button
        type="button"
        className="icon-button"
        title="Open display in a new tab"
        aria-label="Open display in a new tab"
        disabled={!consoleReady}
        onClick={() => openPopout(`/vnc/${vmUUID}`)}
      >
        <i className="bi bi-box-arrow-up-right" />
      </button>
      {stopped ? (
        <button
          type="button"
          className="icon-button is-go"
          onClick={() => onAction(vmUUID, "start")}
          title="Start"
          aria-label="Start virtual machine"
          disabled={transitioning}
        >
          <i className={`bi ${transitioning ? "bi-arrow-clockwise spin" : "bi-play-fill"}`} />
        </button>
      ) : (
        <button
          type="button"
          className="icon-button is-stop"
          onClick={handleStop}
          title="Stop"
          aria-label="Stop virtual machine"
          disabled={busy}
        >
          <i className={`bi ${busy ? "bi-arrow-clockwise spin" : "bi-stop-fill"}`} />
        </button>
      )}
    </div>
  );
};

export default VMActionControls;
