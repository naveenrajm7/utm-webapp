import React from "react";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import ConsoleGate from "./components/ConsoleGate";
import XTerminal from "./components/xterminal";
import { LiveVNCViewer } from "./components/VNCViewer";
import * as v1 from "./v1";
import type { VM } from "./vm";

const ID = "12345678-1234-1234-1234-123456789abc";
const ready: VM = {
  id: ID, name: "Disposable VM", status: "running", backend: "qemu",
  capabilities: { serial: true, display: true },
};

const mockTerminals: Array<{
  emitData: (value: string) => void;
  emitResize: (value: { cols: number; rows: number }) => void;
  dataDisposed: () => boolean;
  resizeDisposed: () => boolean;
  dispose: () => void;
}> = [];
jest.mock("@xterm/xterm", () => ({
  Terminal: class {
    private dataListener?: (value: string) => void;
    private resizeListener?: (value: { cols: number; rows: number }) => void;
    private dataReleased = false;
    private resizeReleased = false;
    constructor() { mockTerminals.push(this); }
    loadAddon() {}
    open() {}
    focus() {}
    write() {}
    dispose = jest.fn();
    onData(listener: (value: string) => void) {
      this.dataListener = listener;
      return { dispose: () => { this.dataReleased = true; } };
    }
    onResize(listener: (value: { cols: number; rows: number }) => void) {
      this.resizeListener = listener;
      return { dispose: () => { this.resizeReleased = true; } };
    }
    emitData(value: string) { this.dataListener?.(value); }
    emitResize(value: { cols: number; rows: number }) { this.resizeListener?.(value); }
    dataDisposed() { return this.dataReleased; }
    resizeDisposed() { return this.resizeReleased; }
  },
}));
jest.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} } }));

const mockRfbClients: Array<{
  emit: (type: "connect" | "disconnect") => void;
  listenerCount: (type: "connect" | "disconnect") => number;
  disconnect: () => void;
}> = [];
jest.mock("@novnc/novnc/lib/rfb", () => ({
  __esModule: true,
  default: class {
    private listeners = {
      connect: new Set<() => void>(),
      disconnect: new Set<() => void>(),
    };
    constructor() { mockRfbClients.push(this); }
    disconnect = jest.fn();
    addEventListener(type: "connect" | "disconnect", listener: () => void) {
      this.listeners[type].add(listener);
    }
    removeEventListener(type: "connect" | "disconnect", listener: () => void) {
      this.listeners[type].delete(listener);
    }
    emit(type: "connect" | "disconnect") {
      this.listeners[type].forEach((listener) => listener());
    }
    listenerCount(type: "connect" | "disconnect") { return this.listeners[type].size; }
  },
}));

type Element = React.ReactElement<{ children?: React.ReactNode; [key: string]: any }>;
const walk = (node: React.ReactNode): Element[] => {
  if (Array.isArray(node)) return node.flatMap(walk);
  if (!React.isValidElement(node)) return [];
  const element = node as Element;
  return [element, ...walk(element.props.children)];
};

const fakeHooks = (refValues: unknown[] = []) => {
  const states: unknown[] = [];
  const refs: Array<{ current: unknown }> = [];
  const callbacks: Array<{ deps: readonly unknown[]; value: unknown }> = [];
  const effects: Array<{ deps?: readonly unknown[]; cleanup?: () => void }> = [];
  let stateIndex = 0;
  let refIndex = 0;
  let callbackIndex = 0;
  let effectIndex = 0;
  const same = (a?: readonly unknown[], b?: readonly unknown[]) =>
    !!a && !!b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));

  jest.spyOn(React, "useState").mockImplementation(((initial: unknown) => {
    const index = stateIndex++;
    if (!(index in states)) states[index] = typeof initial === "function"
      ? (initial as () => unknown)() : initial;
    return [states[index], (next: unknown) => {
      states[index] = typeof next === "function"
        ? (next as (previous: unknown) => unknown)(states[index]) : next;
    }];
  }) as typeof React.useState);
  jest.spyOn(React, "useRef").mockImplementation(((initial: unknown) => {
    const index = refIndex++;
    return refs[index] ?? (refs[index] = { current: refValues[index] ?? initial });
  }) as typeof React.useRef);
  jest.spyOn(React, "useCallback").mockImplementation(((value: unknown, deps: readonly unknown[]) => {
    const index = callbackIndex++;
    if (!same(callbacks[index]?.deps, deps)) callbacks[index] = { deps, value };
    return callbacks[index].value;
  }) as typeof React.useCallback);
  jest.spyOn(React, "useEffect").mockImplementation((callback, deps) => {
    const index = effectIndex++;
    if (same(effects[index]?.deps, deps)) return;
    effects[index]?.cleanup?.();
    const cleanup = callback();
    effects[index] = { deps, cleanup: typeof cleanup === "function" ? cleanup : undefined };
  });

  return {
    render: (component: () => React.ReactNode) => {
      stateIndex = 0;
      refIndex = 0;
      callbackIndex = 0;
      effectIndex = 0;
      return component();
    },
    unmount: () => effects.forEach((effect) => effect.cleanup?.()),
  };
};

const flush = async () => { await new Promise<void>((resolve) => setImmediate(resolve)); };

describe("console reconnect with a fake VM detail API", () => {
  afterEach(() => { jest.restoreAllMocks(); });

  it.each(["serial", "display"] as const)("rechecks status and %s support before reconnecting", async (kind) => {
    let current = ready;
    const getVm = jest.spyOn(v1, "getVm").mockImplementation(async () => current);
    const hooks = fakeHooks();
    let disconnect = () => {};
    const render = () => hooks.render(() => ConsoleGate({
      vmId: ID, kind,
      children: (onDisconnect) => {
        disconnect = onDisconnect;
        return <span>console live</span>;
      },
    }));

    render();
    await flush();
    expect(renderToStaticMarkup(render())).toContain("console live");
    disconnect();
    const lost = render();
    expect(renderToStaticMarkup(lost)).toContain("connection was lost");
    const reconnect = walk(lost).find((element) => element.type === "button")!;

    current = { ...ready, status: "stopped" };
    reconnect.props.onClick();
    await flush();
    expect(renderToStaticMarkup(render())).toContain("Start Disposable VM");

    current = { ...ready, capabilities: { serial: false, display: false } };
    walk(render()).find((element) => element.type === "button")!.props.onClick();
    await flush();
    expect(renderToStaticMarkup(render())).toContain(`no supported ${kind} console`);

    current = ready;
    walk(render()).find((element) => element.type === "button")!.props.onClick();
    await flush();
    expect(renderToStaticMarkup(render())).toContain("console live");
    expect(getVm).toHaveBeenCalledTimes(4);
    hooks.unmount();
  });

  it("keeps a failed detail refresh retryable and ignores a late response after unmount", async () => {
    let resolve: (vm: VM) => void = () => {};
    const pending = new Promise<VM>((done) => { resolve = done; });
    const getVm = jest.spyOn(v1, "getVm")
      .mockRejectedValueOnce(new Error("API temporarily unavailable"))
      .mockImplementationOnce(() => pending);
    const hooks = fakeHooks();
    const render = () => hooks.render(() => ConsoleGate({
      vmId: ID, kind: "display", children: () => <span>console live</span>,
    }));
    render();
    await flush();
    const error = render();
    expect(renderToStaticMarkup(error)).toContain("API temporarily unavailable");
    walk(error).find((element) => element.type === "button")!.props.onClick();
    hooks.unmount();
    resolve(ready);
    await flush();
    expect(getVm).toHaveBeenCalledTimes(2);
    expect(renderToStaticMarkup(render())).not.toContain("console live");
  });
});

describe("console transport cleanup with fake clients", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    Reflect.deleteProperty(global, "window");
    Reflect.deleteProperty(global, "sessionStorage");
    Reflect.deleteProperty(global, "ResizeObserver");
    Reflect.deleteProperty(global, "WebSocket");
    mockTerminals.length = 0;
    mockRfbClients.length = 0;
  });

  it("releases serial socket, listeners, and resize observer after a drop", () => {
    const sockets: Array<{
      readyState: number;
      onopen: (() => void) | null;
      onmessage: ((event: { data: string }) => void) | null;
      onerror: (() => void) | null;
      onclose: (() => void) | null;
      send: ReturnType<typeof jest.fn>;
      close: ReturnType<typeof jest.fn>;
    }> = [];
    class FakeSocket {
      static OPEN = 1;
      readyState = 0;
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      send = jest.fn();
      close = jest.fn(() => { this.readyState = 3; this.onclose?.(); });
      constructor() { sockets.push(this); }
    }
    const disconnectObserver = jest.fn();
    Object.defineProperty(global, "WebSocket", { configurable: true, value: FakeSocket });
    Object.defineProperty(global, "ResizeObserver", { configurable: true,
      value: class { observe() {} disconnect = disconnectObserver; } });
    const cancelFrame = jest.fn();
    Object.defineProperty(global, "window", { configurable: true, value: {
      requestAnimationFrame: () => 7, cancelAnimationFrame: cancelFrame,
      location: { protocol: "http:", hostname: "localhost" },
    } });
    Object.defineProperty(global, "sessionStorage", { configurable: true,
      value: { getItem: () => "test-key" } });
    const onDisconnect = jest.fn();
    const hooks = fakeHooks([{}, {}]);
    hooks.render(() => XTerminal({ vmUUID: ID, onDisconnect }));
    const socket = sockets[0];
    const terminal = mockTerminals[0];
    socket.readyState = 1;
    socket.onopen?.();
    terminal.emitData("help\r");
    terminal.emitResize({ cols: 80, rows: 24 });
    expect(socket.send).toHaveBeenCalledTimes(2);
    socket.onerror?.();
    socket.onclose?.();
    expect(onDisconnect).toHaveBeenCalledTimes(1);
    hooks.unmount();
    expect(socket.close).toHaveBeenCalledTimes(1);
    expect(socket.onclose).toBeNull();
    expect(terminal.dataDisposed()).toBe(true);
    expect(terminal.resizeDisposed()).toBe(true);
    expect(terminal.dispose).toHaveBeenCalledTimes(1);
    expect(disconnectObserver).toHaveBeenCalledTimes(1);
    expect(cancelFrame).toHaveBeenCalledWith(7);
  });

  it("treats a VNC handshake failure as a retryable connection and removes RFB listeners", async () => {
    const onDisconnect = jest.fn();
    const hooks = fakeHooks([{}]);
    hooks.render(() => LiveVNCViewer({ url: "ws://localhost/vnc", onDisconnect }));
    await flush();
    const rfb = mockRfbClients[0];
    expect(rfb).toBeDefined();
    rfb.emit("disconnect");
    expect(onDisconnect).toHaveBeenCalledTimes(1);
    const text = renderToStaticMarkup(hooks.render(() => LiveVNCViewer({
      url: "ws://localhost/vnc", onDisconnect,
    })));
    expect(text).toContain("connection was lost");
    expect(text).not.toContain("no VNC display");
    hooks.unmount();
    expect(rfb.disconnect).toHaveBeenCalledTimes(1);
    expect(rfb.listenerCount("connect")).toBe(0);
    expect(rfb.listenerCount("disconnect")).toBe(0);
  });
});
