import React from "react";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { setApiKey } from "./apiAuth";
import ConsoleGate, { consoleAvailability } from "./components/ConsoleGate";
import VMActionControls from "./components/VMActionControls";
import VMInfo from "./components/VMInfo";
import VMList from "./components/VMList";
import { VmStore } from "./vmStore";
import { formatCpuCores, networkLabel, osBadge, type VM } from "./vm";

const ID = "12345678-1234-1234-1234-123456789abc";
const stopped: VM = {
  id: ID, name: "Disposable VM", status: "stopped", backend: "qemu",
  capabilities: { start: true, stop: false, display: true, serial: true },
  serialPorts: [{ name: "Serial 1" }],
};
const running: VM = {
  ...stopped, status: "running",
  capabilities: { start: false, stop: true, display: true, serial: true },
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
  });

describe("VM flow with a fake /v1 API", () => {
  let current: VM;
  let jobState: "queued" | "succeeded";
  let jobMissing: boolean;
  let detailCalls: number;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_HOST = "http://127.0.0.1:3001";
    current = stopped;
    jobState = "queued";
    jobMissing = false;
    detailCalls = 0;
    const values = new Map<string, string>();
    Object.defineProperty(global, "window", {
      configurable: true, value: { dispatchEvent: () => true },
    });
    Object.defineProperty(global, "sessionStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
        removeItem: (key: string) => { values.delete(key); },
      },
    });
    setApiKey("test-key");
    global.fetch = jest.fn(async (input: string, init?: RequestInit) => {
      const path = new URL(input).pathname;
      if (path === "/v1/vms") return json([current]);
      if (path === `/v1/vms/${ID}`) {
        detailCalls++;
        return json(current);
      }
      if (path === `/v1/vms/${ID}/start` && init?.method === "POST")
        return json({ jobId: "power-1" }, 202);
      if (path === "/v1/jobs/power-1")
        return jobMissing
          ? json({ error: { code: "not_found", message: "Unknown job" } }, 404)
          : json({ id: "power-1", state: jobState });
      return json({ error: { code: "not_found", message: "Unknown route" } }, 404);
    }) as typeof fetch;
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_API_HOST;
    Reflect.deleteProperty(global, "window");
    Reflect.deleteProperty(global, "sessionStorage");
  });

  it("refreshes a selected VM through stopped, running, and console ready states", async () => {
    const store = new VmStore();
    await store.refresh();
    store.select(ID);
    await store.refreshSelected();
    expect(store.getSnapshot().selected).toEqual(stopped);
    expect(consoleAvailability(stopped, "display").ready).toBe(false);

    const stoppedHeader = renderToStaticMarkup(
      <VMActionControls vm={store.getSnapshot().selected!} busy={false} onAction={() => {}} />,
    );
    const stoppedTabs = renderToStaticMarkup(
      <VMInfo vm={store.getSnapshot().selected!} busy={false} onAction={() => {}}
        detailsLoading={false} detailsError={null} />,
    );
    expect(stoppedHeader).toContain('aria-label="Open display in a new tab" disabled');
    expect(stoppedHeader).toContain('aria-label="Open serial console in a new tab" disabled');
    expect(stoppedTabs).toContain(">Display</button>");
    expect(stoppedTabs).toContain(">Serial</button>");

    await store.runAction(ID, "start");
    expect(store.getSnapshot().actionJob?.state).toBe("queued");
    const beforeChange = detailCalls;
    current = running;
    await store.refresh();
    expect(detailCalls).toBeGreaterThan(beforeChange);
    expect(store.getSnapshot().selected?.status).toBe("running");
    jobState = "succeeded";
    await store.pollJob();
    expect(store.getSnapshot().actionJob).toBeNull();
    expect(store.getSnapshot().selected?.capabilities).toEqual(running.capabilities);
    expect(consoleAvailability(store.getSnapshot().selected!, "display").ready).toBe(true);

    const runningHeader = renderToStaticMarkup(
      <VMActionControls vm={store.getSnapshot().selected!} busy={false} onAction={() => {}} />,
    );
    expect(runningHeader).toContain('aria-label="Open display in a new tab"');
    expect(runningHeader).not.toContain('aria-label="Open display in a new tab" disabled');
    expect(runningHeader).toContain('aria-label="Force stop virtual machine"');
  });

  it("does not advertise unsupported consoles or mount a direct console route", async () => {
    current = {
      ...stopped,
      capabilities: { start: true, stop: false, display: false, serial: false },
      serialPorts: [],
    };
    const store = new VmStore();
    await store.refresh();
    store.select(ID);
    await store.refreshSelected();
    const vm = store.getSnapshot().selected!;
    const header = renderToStaticMarkup(
      <VMActionControls vm={vm} busy={false} onAction={() => {}} />,
    );
    const tabs = renderToStaticMarkup(
      <VMInfo vm={vm} busy={false} onAction={() => {}}
        detailsLoading={false} detailsError={null} />,
    );
    expect(header).not.toContain("Open display");
    expect(header).not.toContain("Open serial");
    expect(tabs).not.toContain(">Display</button>");
    expect(tabs).not.toContain(">Serial</button>");
    expect(tabs).not.toContain("Try VNC");
    expect(consoleAvailability(vm, "display").ready).toBe(false);
    expect(consoleAvailability(vm, "serial").ready).toBe(false);
    // A direct route shows its gate until the detail request confirms support.
    expect(renderToStaticMarkup(
      <ConsoleGate vmId={ID} kind="display"><span>Connected</span></ConsoleGate>,
    )).not.toContain("Connected");
  });

  it("keeps confirmed console controls visible while stop details reload", async () => {
    let actual = running;
    let state: "queued" | "succeeded" = "queued";
    let releaseDetails: () => void = () => {};
    let holdDetails: Promise<void> | null = null;
    const store = new VmStore({
      listVms: async () => [actual],
      getVm: async () => { if (holdDetails) await holdDetails; return actual; },
      powerVm: async () => ({ jobId: "stop-1" }),
      getJob: async () => ({ id: "stop-1", state }),
    });
    await store.refresh();
    store.select(ID);
    await store.refreshSelected();
    await store.runAction(ID, "stop");

    holdDetails = new Promise<void>(resolve => { releaseDetails = resolve; });
    actual = stopped;
    state = "succeeded";
    const finishing = store.pollJob();
    await new Promise(resolve => setTimeout(resolve, 0));
    const duringRefresh = store.getSnapshot().selected!;
    expect(duringRefresh.status).toBe("stopped");
    expect(duringRefresh.capabilities).toMatchObject({ serial: true, display: true, start: true, stop: false });
    const tabs = renderToStaticMarkup(
      <VMInfo vm={duringRefresh} busy={true} onAction={() => {}}
        detailsLoading={true} detailsError={null} />,
    );
    expect(tabs).toContain(">Display</button>");
    expect(tabs).toContain(">Serial</button>");

    releaseDetails();
    await finishing;
    expect(store.getSnapshot().selected?.capabilities).toMatchObject({ serial: true, display: true });
    expect(store.getSnapshot().busyUuid).toBeNull();
  });

  it("recovers actual VM state when an API restart loses a power job", async () => {
    const store = new VmStore();
    await store.refresh();
    store.select(ID);
    await store.refreshSelected();
    await store.runAction(ID, "start");
    current = running;
    jobMissing = true;
    await store.pollJob();
    expect(store.getSnapshot().actionJob).toBeNull();
    expect(store.getSnapshot().busyUuid).toBeNull();
    expect(store.getSnapshot().actionError).toContain("confirm the outcome before trying again");
    expect(store.getSnapshot().selected?.status).toBe("running");
    expect(store.getSnapshot().selected?.capabilities).toEqual(running.capabilities);
    store.dismissActionError();
    expect(store.getSnapshot().actionError).toBeNull();
  });

  it("presents a serial-only VM without a graphical preview", () => {
    const serialOnly: VM = {
      ...stopped,
      name: "vagrant_test_default_1744595654130_77151",
      icon: "debian",
      cpuCores: 0,
      network: "other",
      networkInterfaces: [{ mode: "bridged" }],
      capabilities: { start: true, stop: false, display: false, serial: true },
    };
    expect(osBadge(serialOnly).tone).toBe("linux");
    expect(formatCpuCores(0)).toBe("Automatic");
    expect(networkLabel(serialOnly)).toBe("Bridged");
    expect(networkLabel({ network: "shared" })).toBe("Shared Network");
    const tabs = renderToStaticMarkup(
      <VMInfo vm={serialOnly} busy={false} onAction={() => {}}
        detailsLoading={false} detailsError={null} />,
    );
    expect(tabs).toContain(">Serial</button>");
    expect(tabs).not.toContain(">Display</button>");
    expect(tabs).toContain("no graphical display");
    expect(tabs).not.toContain("<h1>");
    expect(tabs).toContain("Automatic");
    expect(tabs).toContain("Bridged");
    expect(tabs).not.toContain("vm-screen");
    const withPreview = renderToStaticMarkup(
      <VMInfo vm={{ ...stopped, screenshot: "data:image/png;base64,abcd" }} busy={false}
        onAction={() => {}} detailsLoading={false} detailsError={null} />,
    );
    expect(withPreview).toContain('src="data:image/png;base64,abcd"');
    expect(withPreview).toContain(">Display</button>");
    const rejected = renderToStaticMarkup(
      <VMInfo vm={{ ...stopped, screenshot: "https://evil.example/preview.png" }} busy={false}
        onAction={() => {}} detailsLoading={false} detailsError={null} />,
    );
    expect(rejected).not.toContain("evil.example");
    expect(rejected).toContain("No saved preview");
    const list = renderToStaticMarkup(
      <VMList vms={[serialOnly]} loading={false} error={null} selectedUUID={null}
        busyUuid={null} onSelectVM={() => {}} onAction={() => {}} onRetry={() => {}} />,
    );
    expect(list).toContain(`title="${serialOnly.name}"`);
    expect(list).toContain(`aria-label="Start ${serialOnly.name}"`);
  });
});
