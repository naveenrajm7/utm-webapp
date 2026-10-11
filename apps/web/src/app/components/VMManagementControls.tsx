"use client";

import { useState, type FormEvent } from "react";
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

  const open = (next: Mode) => {
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
    setMode(null);
  };

  const available = {
    clone: hasCapability(vm, "clone"),
    configure: hasCapability(vm, "configure"),
    delete: hasCapability(vm, "delete"),
  };
  const activeMode = mode && available[mode] ? mode : null;

  if (!available.clone && !available.configure && !available.delete) return null;

  return (
    <div className="vm-management">
      <div className="vm-management-actions">
        {available.clone && <button type="button" className="push-button" disabled={busy}
          onClick={() => open("clone")}>Clone</button>}
        {available.configure && <button type="button" className="push-button" disabled={busy}
          onClick={() => open("configure")}>Settings</button>}
        {available.delete && <button type="button" className="push-button vm-delete-button" disabled={busy}
          onClick={() => open("delete")}>Delete</button>}
      </div>
      {activeMode && (
        <div className="vm-dialog-backdrop">
          <section className="vm-dialog" role="dialog" aria-modal="true"
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
                <button type="button" className="push-button" onClick={() => setMode(null)}>Cancel</button>
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
