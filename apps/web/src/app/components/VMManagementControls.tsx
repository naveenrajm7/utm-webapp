"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import type { VmOperation } from "../vmStore";
import { hasCapability, isBusyStatus, type VM } from "../vm";

type Mode = VmOperation["action"];

interface Props {
  vm: VM;
  busy: boolean;
  onSubmit: (id: string, operation: VmOperation) => void;
  toolbar?: boolean;
}

export const validName = (value: string): boolean => {
  const trimmed = value.trim();
  return (
    trimmed.length >= 1 &&
    trimmed.length <= 100 &&
    !Array.from(trimmed).some((char) => {
      const code = char.charCodeAt(0);
      return code < 32 || (code >= 127 && code <= 159);
    })
  );
};

export const exactDeleteConfirmation = (name: string, typed: string): boolean =>
  typed === name;

const parseInteger = (
  value: string,
  min: number,
  max: number,
): number | null => {
  if (!/^(0|[1-9]\d*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : null;
};

const VMManagementControls = ({
  vm,
  busy,
  onSubmit,
  toolbar = false,
}: Props) => {
  const [mode, setMode] = useState<Mode | null>(null);
  const [settingsPane, setSettingsPane] = useState<"information" | "system">(
    "information",
  );
  const [name, setName] = useState("");
  const [memory, setMemory] = useState("");
  const [cores, setCores] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);
  const submittedRef = useRef(false);
  const transitioning = busy || isBusyStatus(vm.status);

  const available = {
    clone: hasCapability(vm, "clone"),
    configure: hasCapability(vm, "configure"),
    delete: hasCapability(vm, "delete"),
  };
  const activeMode = mode && available[mode] ? mode : null;

  useEffect(() => {
    if (activeMode) {
      dialogRef.current
        ?.querySelector<HTMLInputElement>("input:not([hidden] *)")
        ?.focus();
    } else if (returnFocusRef.current) {
      const trigger = returnFocusRef.current;
      if (!submittedRef.current && trigger.isConnected && !trigger.disabled) {
        trigger.focus();
      } else {
        actionsRef.current?.focus();
      }
      returnFocusRef.current = null;
      submittedRef.current = false;
    }
  }, [activeMode, settingsPane]);

  const close = (submitted = false) => {
    submittedRef.current = submitted;
    setMode(null);
  };

  const onDialogKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'input:not(:disabled):not([hidden] *), button:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const open = (next: Mode, trigger: HTMLButtonElement) => {
    returnFocusRef.current = trigger;
    setMode(next);
    setSettingsPane("information");
    setName(next === "configure" ? vm.name : "");
    setMemory(vm.memoryMiB == null ? "" : String(vm.memoryMiB));
    setCores(vm.cpuCores == null ? "" : String(vm.cpuCores));
    setConfirmation("");
    setFormError(null);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!mode || transitioning) return;
    if (mode === "clone") {
      if (!validName(name)) {
        setFormError("Enter a printable name from 1 to 100 characters.");
        return;
      }
      onSubmit(vm.id, { action: "clone", name: name.trim() });
    } else if (mode === "configure") {
      const patch: Extract<VmOperation, { action: "configure" }>["patch"] = {};
      if (name.trim() !== vm.name) {
        if (!validName(name)) {
          setSettingsPane("information");
          setFormError("Enter a printable name from 1 to 100 characters.");
          return;
        }
        patch.name = name.trim();
      }
      if (memory !== (vm.memoryMiB == null ? "" : String(vm.memoryMiB))) {
        const value = parseInteger(memory, 128, 1048576);
        if (value === null) {
          setSettingsPane("system");
          setFormError("RAM must be a whole number from 128 to 1,048,576 MiB.");
          return;
        }
        patch.memoryMiB = value;
      }
      if (cores !== (vm.cpuCores == null ? "" : String(vm.cpuCores))) {
        const value = parseInteger(cores, 0, 256);
        if (value === null) {
          setSettingsPane("system");
          setFormError("CPU cores must be a whole number from 0 to 256.");
          return;
        }
        patch.cpuCores = value;
      }
      if (Object.keys(patch).length === 0) {
        setFormError("Change at least one setting.");
        return;
      }
      onSubmit(vm.id, { action: "configure", patch });
    } else {
      if (!exactDeleteConfirmation(vm.name, confirmation)) {
        setFormError("Type the exact VM name to confirm deletion.");
        return;
      }
      onSubmit(vm.id, { action: "delete", confirmName: confirmation });
    }
    close(true);
  };

  if (!available.clone && !available.configure && !available.delete)
    return null;

  return (
    <div className={`vm-management ${toolbar ? "in-toolbar" : ""}`}>
      <div
        className="vm-management-actions"
        ref={actionsRef}
        tabIndex={-1}
        role="group"
        aria-label="VM management actions"
      >
        {available.delete && (
          <button
            type="button"
            className={toolbar ? "icon-button" : "push-button vm-delete-button"}
            disabled={transitioning}
            title="Delete"
            onClick={(event) => open("delete", event.currentTarget)}
          >
            {toolbar ? (
              <>
                <i className="bi bi-trash" aria-hidden="true" />
                <span className="sr-only">Delete</span>
              </>
            ) : (
              "Delete"
            )}
          </button>
        )}
        {available.clone && (
          <button
            type="button"
            className={toolbar ? "icon-button" : "push-button"}
            disabled={transitioning}
            title="Clone"
            onClick={(event) => open("clone", event.currentTarget)}
          >
            {toolbar ? (
              <>
                <i className="bi bi-copy" aria-hidden="true" />
                <span className="sr-only">Clone</span>
              </>
            ) : (
              "Clone"
            )}
          </button>
        )}
        {available.configure && (
          <button
            type="button"
            className={toolbar ? "icon-button" : "push-button"}
            disabled={transitioning}
            title="Settings"
            onClick={(event) => open("configure", event.currentTarget)}
          >
            {toolbar ? (
              <>
                <i className="bi bi-sliders" aria-hidden="true" />
                <span className="sr-only">Settings</span>
              </>
            ) : (
              "Settings"
            )}
          </button>
        )}
      </div>
      {activeMode && (
        <div className="vm-dialog-backdrop">
          <section
            className={`vm-dialog ${activeMode === "configure" ? "vm-settings-sheet" : "vm-alert-sheet"}`}
            role="dialog"
            aria-modal="true"
            ref={dialogRef}
            onKeyDown={onDialogKeyDown}
            aria-label={
              activeMode === "configure"
                ? "VM settings"
                : activeMode === "clone"
                  ? "Clone VM"
                  : "Delete VM"
            }
          >
            {activeMode !== "configure" && (
              <>
                <div
                  className={`dialog-symbol ${activeMode === "delete" ? "is-destructive" : ""}`}
                  aria-hidden="true"
                >
                  <i
                    className={`bi ${activeMode === "clone" ? "bi-copy" : "bi-exclamation-triangle"}`}
                  />
                </div>
                <h2>{activeMode === "clone" ? "Clone VM" : "Delete VM"}</h2>
                <p>{vm.name}</p>
              </>
            )}
            <form onSubmit={submit} noValidate>
              {activeMode === "clone" && (
                <>
                  <p>
                    Create a separate copy of this virtual machine and its data.
                  </p>
                  <label>
                    Clone name
                    <input
                      className="text-field"
                      autoFocus
                      value={name}
                      maxLength={100}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </label>
                </>
              )}
              {activeMode === "configure" && (
                <div className="settings-body">
                  <nav
                    className="settings-sidebar"
                    aria-label="VM settings sections"
                  >
                    <h2>VM settings</h2>
                    <button
                      type="button"
                      aria-current={
                        settingsPane === "information" ? "page" : undefined
                      }
                      onClick={() => setSettingsPane("information")}
                    >
                      <i className="bi bi-info-circle" aria-hidden="true" />
                      Information
                    </button>
                    <button
                      type="button"
                      aria-current={
                        settingsPane === "system" ? "page" : undefined
                      }
                      onClick={() => setSettingsPane("system")}
                    >
                      <i className="bi bi-cpu" aria-hidden="true" />
                      System
                    </button>
                  </nav>
                  <div className="settings-content">
                    <div
                      hidden={settingsPane !== "information"}
                      className="settings-panel"
                    >
                      <h3>Information</h3>
                      <label>
                        Name
                        <input
                          className="text-field"
                          value={name}
                          maxLength={100}
                          onChange={(event) => setName(event.target.value)}
                        />
                      </label>
                      <p className="settings-description">{vm.name}</p>
                    </div>
                    <div
                      hidden={settingsPane !== "system"}
                      className="settings-panel"
                    >
                      <h3>Hardware</h3>
                      <label>
                        RAM (MiB)
                        <input
                          className="text-field"
                          type="number"
                          min={128}
                          max={1048576}
                          step={1}
                          value={memory}
                          onChange={(event) => setMemory(event.target.value)}
                        />
                      </label>
                      <label>
                        CPU cores
                        <input
                          className="text-field"
                          type="number"
                          min={0}
                          max={256}
                          step={1}
                          value={cores}
                          onChange={(event) => setCores(event.target.value)}
                        />
                        <span>(0 uses host default)</span>
                      </label>
                    </div>
                  </div>
                </div>
              )}
              {activeMode === "delete" && (
                <>
                  <p>
                    Delete this VM and its data? Type <strong>{vm.name}</strong>{" "}
                    exactly to confirm.
                  </p>
                  <label>
                    VM name
                    <input
                      className="text-field"
                      autoFocus
                      value={confirmation}
                      autoComplete="off"
                      onChange={(event) => setConfirmation(event.target.value)}
                    />
                  </label>
                </>
              )}
              {formError && (
                <p className="vm-form-error" role="alert">
                  {formError}
                </p>
              )}
              <div className="vm-dialog-actions">
                <button
                  type="button"
                  className="push-button"
                  onClick={() => close()}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={
                    activeMode === "delete"
                      ? "push-button vm-delete-button"
                      : "push-button is-default"
                  }
                  disabled={
                    transitioning ||
                    (activeMode === "delete" &&
                      !exactDeleteConfirmation(vm.name, confirmation))
                  }
                >
                  {activeMode === "clone"
                    ? "Clone VM"
                    : activeMode === "configure"
                      ? "Save settings"
                      : "Delete VM"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
};

export default VMManagementControls;
