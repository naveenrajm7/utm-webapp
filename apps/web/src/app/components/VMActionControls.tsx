"use client";

import {
  canOpenConsole,
  hasCapability,
  isActiveStatus,
  isBusyStatus,
  isStopped,
  type VM,
  type VmAction,
} from "../vm";
import { consolePath } from "../demo";

interface VMActionControlsProps {
  vm: VM;
  busy: boolean;
  onAction: (uuid: string, action: VmAction) => void;
}

const VMActionControls = ({ vm, busy, onAction }: VMActionControlsProps) => {
  const consoleReady = canOpenConsole(vm.status);
  const stopped = isStopped(vm.status);
  const transitioning = busy || isBusyStatus(vm.status);

  const openPopout = (path: string) => {
    window.open(path, "_blank", "noopener,noreferrer");
  };

  const handleStop = () => {
    if (window.confirm(`Stop ${vm.name}?`)) {
      onAction(vm.id, "stop");
    }
  };

  return (
    <div className="header-actions">
      {hasCapability(vm, "serial") && (
        <button
          type="button"
          className="icon-button"
          title="Open serial console in a new tab"
          aria-label="Open serial console in a new tab"
          disabled={!consoleReady}
          onClick={() => openPopout(consolePath("terminal", vm.id))}
        >
          <i className="bi bi-terminal" />
        </button>
      )}
      {hasCapability(vm, "display") && (
        <button
          type="button"
          className="icon-button"
          title="Open display in a new tab"
          aria-label="Open display in a new tab"
          disabled={!consoleReady}
          onClick={() => openPopout(consolePath("vnc", vm.id))}
        >
          <i className="bi bi-display" />
        </button>
      )}
      {stopped && hasCapability(vm, "start") ? (
        <button
          type="button"
          className="icon-button is-go"
          onClick={() => onAction(vm.id, "start")}
          title="Start"
          aria-label="Start virtual machine"
          disabled={transitioning}
        >
          <i
            className={`bi ${transitioning ? "bi-arrow-clockwise spin" : "bi-play-fill"}`}
          />
        </button>
      ) : isActiveStatus(vm.status) && hasCapability(vm, "stop") ? (
        <button
          type="button"
          className="icon-button is-stop"
          onClick={handleStop}
          title="Stop"
          aria-label="Stop virtual machine"
          disabled={transitioning}
        >
          <i
            className={`bi ${busy ? "bi-arrow-clockwise spin" : "bi-stop-fill"}`}
          />
        </button>
      ) : null}
    </div>
  );
};

export default VMActionControls;
