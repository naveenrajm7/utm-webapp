import React from "react";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import VMManagementControls from "./components/VMManagementControls";
import type { VM } from "./vm";
import type { VmOperation } from "./vmStore";

const vm: VM = {
  id: "12345678-1234-1234-1234-123456789abc",
  name: "Disposable VM", status: "stopped", backend: "qemu",
  memoryMiB: 2048, cpuCores: 2,
  capabilities: { clone: true, configure: true, delete: true },
};

type Element = React.ReactElement<{ children?: React.ReactNode; [key: string]: any }>;
const walk = (node: React.ReactNode): Element[] => {
  if (Array.isArray(node)) return node.flatMap(walk);
  if (!React.isValidElement(node)) return [];
  const element = node as Element;
  return [element, ...walk(element.props.children)];
};
const label = (node: React.ReactNode): string => {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(label).join("");
  return React.isValidElement(node) ? label((node as Element).props.children) : "";
};

const harness = () => {
  const values: unknown[] = [];
  const refs: Array<{ current: unknown }> = [];
  let cursor = 0;
  let refCursor = 0;
  let effect: (() => void) | null = null;
  jest.spyOn(React, "useState").mockImplementation(((initial: unknown) => {
    const index = cursor++;
    if (!(index in values)) values[index] = initial;
    return [values[index], (next: unknown) => {
      values[index] = typeof next === "function"
        ? (next as (previous: unknown) => unknown)(values[index]) : next;
    }];
  }) as typeof React.useState);
  jest.spyOn(React, "useRef").mockImplementation(((initial: unknown) => {
    const index = refCursor++;
    return refs[index] ?? (refs[index] = { current: initial });
  }) as typeof React.useRef);
  jest.spyOn(React, "useEffect").mockImplementation((callback) => { effect = callback; });
  const onSubmit = jest.fn<(id: string, operation: VmOperation) => void>();
  const render = () => {
    cursor = 0;
    refCursor = 0;
    return walk(VMManagementControls({ vm, busy: false, onSubmit }));
  };
  const findButton = (text: string) => render().find((element) =>
    element.type === "button" && label(element.props.children) === text)!;
  const clickButton = (text: string, trigger = { focus: () => {}, isConnected: true, disabled: false }) =>
    findButton(text).props.onClick({ currentTarget: trigger });
  const inputs = () => render().filter((element) => element.type === "input");
  const submit = () => render().find((element) => element.type === "form")!
    .props.onSubmit({ preventDefault: () => {} });
  const commit = (dialog?: unknown, actions?: unknown) => {
    refs[0].current = dialog ?? null;
    refs[1].current = actions ?? null;
    effect?.();
  };
  return { onSubmit, render, findButton, clickButton, inputs, submit, commit };
};

describe("VM management dialogs", () => {
  afterEach(() => { jest.restoreAllMocks(); });

  it("validates and submits clone through the dialog", () => {
    const ui = harness();
    ui.clickButton("Clone");
    expect(ui.render().some((element) => element.props.role === "dialog" &&
      element.props["aria-label"] === "Clone VM")).toBe(true);
    ui.submit();
    expect(label(ui.render())).toContain("Enter a printable name");
    ui.inputs()[0].props.onChange({ target: { value: "  Copy  " } });
    ui.submit();
    expect(ui.onSubmit).toHaveBeenCalledWith(vm.id, { action: "clone", name: "Copy" });
    expect(ui.render().some((element) => element.props.role === "dialog")).toBe(false);
  });

  it("validates changed settings and submits the requested patch", () => {
    const ui = harness();
    ui.clickButton("Settings");
    ui.submit();
    expect(label(ui.render())).toContain("Change at least one setting");
    ui.inputs()[1].props.onChange({ target: { value: "127" } });
    ui.submit();
    expect(label(ui.render())).toContain("RAM must be a whole number");
    ui.inputs()[0].props.onChange({ target: { value: "Renamed VM" } });
    ui.inputs()[1].props.onChange({ target: { value: "4096" } });
    ui.inputs()[2].props.onChange({ target: { value: "0" } });
    ui.submit();
    expect(ui.onSubmit).toHaveBeenCalledWith(vm.id, {
      action: "configure", patch: { name: "Renamed VM", memoryMiB: 4096, cpuCores: 0 },
    });
  });

  it("requires the exact name before submitting delete", () => {
    const ui = harness();
    ui.clickButton("Delete");
    expect(ui.findButton("Delete VM").props.disabled).toBe(true);
    ui.inputs()[0].props.onChange({ target: { value: "disposable VM" } });
    ui.submit();
    expect(ui.onSubmit).not.toHaveBeenCalled();
    ui.inputs()[0].props.onChange({ target: { value: vm.name } });
    expect(ui.findButton("Delete VM").props.disabled).toBe(false);
    ui.submit();
    expect(ui.onSubmit).toHaveBeenCalledWith(vm.id, {
      action: "delete", confirmName: vm.name,
    });
  });

  it.each(["Clone", "Settings", "Delete"])("focuses, traps Tab, and restores focus for %s", (mode) => {
    const ui = harness();
    const active = { current: null as unknown };
    Object.defineProperty(global, "document", {
      configurable: true, value: { get activeElement() { return active.current; } },
    });
    const field = { focus: () => { active.current = field; } };
    const last = { focus: () => { active.current = last; } };
    const trigger = { focus: jest.fn(() => { active.current = trigger; }),
      isConnected: true, disabled: false };
    ui.clickButton(mode, trigger);
    const dialogElement = ui.render().find((element) => element.props.role === "dialog")!;
    const dialog = {
      querySelector: () => field,
      querySelectorAll: () => [field, last],
    };
    ui.commit(dialog);
    expect(active.current).toBe(field);
    const preventDefault = jest.fn();
    dialogElement.props.onKeyDown({ key: "Tab", shiftKey: true, preventDefault });
    expect(active.current).toBe(last);
    dialogElement.props.onKeyDown({ key: "Tab", shiftKey: false, preventDefault });
    expect(active.current).toBe(field);
    expect(preventDefault).toHaveBeenCalledTimes(2);
    const stopPropagation = jest.fn();
    dialogElement.props.onKeyDown({ key: "Escape", preventDefault, stopPropagation });
    ui.render();
    ui.commit();
    expect(trigger.focus).toHaveBeenCalledTimes(1);
    expect(ui.render().some((element) => element.props.role === "dialog")).toBe(false);
    Reflect.deleteProperty(global, "document");
  });

  it("moves focus to the action group after submission", () => {
    const ui = harness();
    const actions = { focus: jest.fn() };
    ui.clickButton("Clone");
    ui.render();
    ui.commit({ querySelector: () => ({ focus: () => {} }) }, actions);
    ui.inputs()[0].props.onChange({ target: { value: "Copy" } });
    ui.submit();
    ui.render();
    ui.commit(undefined, actions);
    expect(actions.focus).toHaveBeenCalledTimes(1);
  });
});
