import React from "react";
import { beforeEach, afterEach, describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { setApiKey } from "./apiAuth";
import VMManagementControls, {
  exactDeleteConfirmation, validName,
} from "./components/VMManagementControls";
import { VmStore } from "./vmStore";
import type { VM } from "./vm";

const ID = "12345678-1234-1234-1234-123456789abc";
const COPY_ID = "12345678-1234-1234-1234-123456789abd";
const source = (): VM => ({
  id: ID, name: "Disposable VM", status: "stopped", backend: "qemu",
  memoryMiB: 2048, cpuCores: 2,
  capabilities: { start: true, stop: false, clone: true, configure: true,
    delete: true, guestExec: false, networkPresets: [] },
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status,
    headers: { "Content-Type": "application/json" } });

describe("direct VM management against a fake /v1 API", () => {
  let vms: VM[];
  let state: "queued" | "running" | "succeeded" | "failed";
  let lost: boolean;
  let fetchMock: ReturnType<typeof jest.fn>;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_HOST = "http://127.0.0.1:3001";
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
    vms = [source()];
    state = "queued";
    lost = false;
    fetchMock = jest.fn(async (input: string, init?: RequestInit) => {
      const path = new URL(input).pathname;
      const method = init?.method || "GET";
      if (path === "/v1/vms") return json(vms);
      if (path === `/v1/vms/${ID}` && method === "GET")
        return json(vms.find((vm) => vm.id === ID));
      if (path === `/v1/vms/${ID}/clone` && method === "POST")
        return json({ jobId: "job-1" }, 202);
      if (path === `/v1/vms/${ID}` && method === "PATCH")
        return json({ jobId: "job-1" }, 202);
      if (path === `/v1/vms/${ID}` && method === "DELETE")
        return json({ jobId: "job-1" }, 202);
      if (path === "/v1/jobs/job-1")
        return lost
          ? json({ error: { code: "not_found", message: "Job not found" } }, 404)
          : json({ id: "job-1", state,
            ...(state === "failed"
              ? { error: { code: "unavailable", message: "UTM is unavailable" } }
              : { result: { vmId: COPY_ID } }) });
      return json({ error: { code: "not_found", message: "Unknown route" } }, 404);
    });
    global.fetch = fetchMock as typeof fetch;
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_API_HOST;
    Reflect.deleteProperty(global, "window");
    Reflect.deleteProperty(global, "sessionStorage");
  });

  const ready = async () => {
    const store = new VmStore();
    await store.refresh();
    store.select(ID);
    await store.refreshSelected();
    return store;
  };

  it("shows only supported controls and requires an exact name", () => {
    const vm = source();
    const html = renderToStaticMarkup(
      <VMManagementControls vm={vm} busy={false} onSubmit={() => {}} />,
    );
    expect(html).toContain(">Clone</button>");
    expect(html).toContain(">Settings</button>");
    expect(html).toContain(">Delete</button>");
    expect(html).not.toContain("Network");
    expect(renderToStaticMarkup(
      <VMManagementControls vm={{ ...vm,
        capabilities: { ...vm.capabilities, clone: false, configure: false,
          delete: false } }} busy={false} onSubmit={() => {}} />,
    )).not.toContain("Delete");
    expect(exactDeleteConfirmation(vm.name, "disposable VM")).toBe(false);
    expect(exactDeleteConfirmation(vm.name, vm.name)).toBe(true);
    expect(validName("  Copy  ")).toBe(true);
    expect(validName("bad\nname")).toBe(false);
  });

  it("tracks clone, settings, and delete jobs and refreshes actual VM state", async () => {
    const store = await ready();
    await store.runManagement(ID, { action: "clone", name: "Copy" });
    expect(store.getSnapshot().actionJob).toEqual({ action: "clone", state: "queued" });
    state = "running";
    await store.pollJob();
    expect(store.getSnapshot().actionJob?.state).toBe("running");
    vms.push({ ...source(), id: COPY_ID, name: "Copy" });
    state = "succeeded";
    await store.pollJob();
    expect(store.getSnapshot().vms.map((vm) => vm.name)).toEqual(["Disposable VM", "Copy"]);
    expect(store.getSnapshot().selected?.id).toBe(ID);
    expect(store.getSnapshot().actionJob).toBeNull();

    state = "queued";
    await store.runManagement(ID, { action: "configure",
      patch: { name: "Renamed VM", memoryMiB: 4096, cpuCores: 0 } });
    vms[0] = { ...vms[0], name: "Renamed VM", memoryMiB: 4096, cpuCores: 0 };
    state = "succeeded";
    await store.pollJob();
    expect(store.getSnapshot().selected?.name).toBe("Renamed VM");
    expect(store.getSnapshot().selected?.memoryMiB).toBe(4096);

    state = "queued";
    await store.runManagement(ID, { action: "delete", confirmName: "Renamed VM" });
    vms = vms.filter((vm) => vm.id !== ID);
    state = "succeeded";
    await store.pollJob();
    expect(store.getSnapshot().selectedId).toBeNull();
    expect(store.getSnapshot().vms).toHaveLength(1);
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(JSON.parse(String(calls.find(([url]) => url.endsWith("/clone"))?.[1].body)))
      .toEqual({ name: "Copy" });
    expect(JSON.parse(String(calls.find(([, init]) => init.method === "PATCH")?.[1].body)))
      .toEqual({ name: "Renamed VM", memoryMiB: 4096, cpuCores: 0 });
    expect(JSON.parse(String(calls.find(([, init]) => init.method === "DELETE")?.[1].body)))
      .toEqual({ confirmName: "Renamed VM" });
  });

  it("blocks unsupported actions and a mismatched delete confirmation", async () => {
    vms[0].capabilities = { ...vms[0].capabilities,
      clone: false, configure: false, delete: false };
    const store = await ready();
    await store.runManagement(ID, { action: "clone", name: "Copy" });
    await store.runManagement(ID, { action: "configure", patch: { memoryMiB: 4096 } });
    await store.runManagement(ID, { action: "delete", confirmName: "wrong" });
    expect(store.getSnapshot().actionError).toContain("conflict:");
    expect(fetchMock.mock.calls.filter(([, init]) =>
      ["POST", "PATCH", "DELETE"].includes((init as RequestInit)?.method || "")))
      .toHaveLength(0);
  });

  it("shows typed admission and job failures, then refreshes inventory", async () => {
    const store = await ready();
    fetchMock.mockResolvedValueOnce(
      json({ error: { code: "unsupported", message: "Clone unavailable" } }, 422),
    );
    await store.runManagement(ID, { action: "clone", name: "Copy" });
    expect(store.getSnapshot().actionError).toContain("unsupported: Clone unavailable");
    expect(store.getSnapshot().busyUuid).toBeNull();

    state = "failed";
    await store.runManagement(ID, { action: "configure", patch: { cpuCores: 4 } });
    expect(store.getSnapshot().actionError).toContain("unavailable: UTM is unavailable");
    expect(store.getSnapshot().actionJob).toBeNull();
  });

  it("treats a lost clone job after API restart as unknown and never retries it", async () => {
    const store = await ready();
    await store.runManagement(ID, { action: "clone", name: "Copy" });
    vms.push({ ...source(), id: COPY_ID, name: "Copy" });
    lost = true;
    await store.pollJob();
    expect(store.getSnapshot().vms.map((vm) => vm.name)).toContain("Copy");
    expect(store.getSnapshot().actionError).toContain("confirm the outcome before trying again");
    expect(store.getSnapshot().actionJob).toBeNull();
    expect(fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith("/clone"))).toHaveLength(1);
  });
});
