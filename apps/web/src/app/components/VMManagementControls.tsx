"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { VmOperation } from "../vmStore";
import { hasCapability, type VM } from "../vm";

type Mode = VmOperation["action"];

interface Props {
  vm: VM;
  busy: boolean;
  onSubmit: (id: string, operation: VmOperation) => void;
}

export const validName = (value: string): boolean => {
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= 100 && !Array.from(trimmed).some((char) => {
    const code = char.charCodeAt(0);
    return code < 32 || (code >= 127 && code <= 159);
  });
};

export const exactDeleteConfirmation = (name: string, typed: string): boolean =>
  typed === name;

const parseInteger = (value: string, min: number, max: number): number | null => {
  if (!/^(0|[1-9]\d*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max
    ? parsed : null;
};

const VMManagementControls = ({ vm, busy, onSubmit }: Props) => {
  const [mode, setMode] = useState<Mode | null>(null);
  const [name, setName] = useState("");
  const [memory, setMemory] = useState("");
  const [cores, setCores] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);
  const submittedRef = useRef(false);

  const available = {
    clone: hasCapability(vm, "clone"),
    configure: hasCapability(vm, "configure"),
    delete: hasCapability(vm, "delete"),
  };
  const activeMode = mode && available[mode] ? mode : null;

  useEffect(() => {
    if (activeMode) {
      dialogRef.current?.querySelector<HTMLInputElement>("input")?.focus();
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
  }, [activeMode]);

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
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'input:not(:disabled), button:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ) ?? []);
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
    setName(next === "configure" ? vm.name : "");
    setMemory(vm.memoryMiB == null ? "" : String(vm.memoryMiB));
    setCores(vm.cpuCores == null ? "" : String(vm.cpuCores));
    setConfirmation("");
    setFormError(null);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!mode || busy) return;
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
          setFormError("Enter a printable name from 1 to 100 characters.");
          return;
        }
        patch.name = name.trim();
      }
      if (memory !== (vm.memoryMiB == null ? "" : String(vm.memoryMiB))) {
        const value = parseInteger(memory, 128, 1048576);
        if (value === null) {
          setFormError("RAM must be a whole number from 128 to 1,048,576 MiB.");
          return;
        }
        patch.memoryMiB = value;
      }
      if (cores !== (vm.cpuCores == null ? "" : String(vm.cpuCores))) {
        const value = parseInteger(cores, 0, 256);
        if (value === null) {
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

  if (!available.clone && !available.configure && !available.delete) return null;

  return (
    <div className="vm-management">
      <div className="vm-management-actions" ref={actionsRef} tabIndex={-1}
        role="group" aria-label="VM management actions">
        {available.clone && <button type="button" className="push-button" disabled={busy}
          onClick={(event) => open("clone", event.currentTarget)}>Clone</button>}
        {available.configure && <button type="button" className="push-button" disabled={busy}
          onClick={(event) => open("configure", event.currentTarget)}>Settings</button>}
        {available.delete && <button type="button" className="push-button vm-delete-button" disabled={busy}
          onClick={(event) => open("delete", event.currentTarget)}>Delete</button>}
      </div>
      {activeMode && (
        <div className="vm-dialog-backdrop">
          <section className="vm-dialog" role="dialog" aria-modal="true" ref={dialogRef}
            onKeyDown={onDialogKeyDown}
            aria-label={activeMode === "configure" ? "VM settings" : activeMode === "clone" ? "Clone VM" : "Delete VM"}>
            <h2>{activeMode === "configure" ? "VM settings" : activeMode === "clone" ? "Clone VM" : "Delete VM"}</h2>
            <p>{vm.name}</p>
            <form onSubmit={submit}>
              {activeMode === "clone" && (
                <label>Clone name<input className="text-field" autoFocus value={name}
                  maxLength={100} onChange={(event) => setName(event.target.value)} /></label>
              )}
              {activeMode === "configure" && (
                <>
                  <label>Name<input className="text-field" value={name} maxLength={100}
                    onChange={(event) => setName(event.target.value)} /></label>
                  <label>RAM (MiB)<input className="text-field" type="number" min={128} max={1048576}
                    step={1} value={memory} onChange={(event) => setMemory(event.target.value)} /></label>
                  <label>CPU cores <span>(0 uses host default)</span>
                    <input className="text-field" type="number" min={0} max={256} step={1}
                      value={cores} onChange={(event) => setCores(event.target.value)} />
                  </label>
                </>
              )}
              {activeMode === "delete" && (
                <>
                  <p>Delete this VM and its data? Type <strong>{vm.name}</strong> exactly to confirm.</p>
                  <label>VM name<input className="text-field" autoFocus value={confirmation}
                    autoComplete="off" onChange={(event) => setConfirmation(event.target.value)} /></label>
                </>
              )}
              {formError && <p className="vm-form-error" role="alert">{formError}</p>}
              <div className="vm-dialog-actions">
                <button type="button" className="push-button" onClick={() => close()}>Cancel</button>
                <button type="submit" className={activeMode === "delete"
                  ? "push-button vm-delete-button" : "push-button is-default"}
                  disabled={busy || (activeMode === "delete" &&
                    !exactDeleteConfirmation(vm.name, confirmation))}>
                  {activeMode === "clone" ? "Clone VM" : activeMode === "configure" ? "Save settings" : "Delete VM"}
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
