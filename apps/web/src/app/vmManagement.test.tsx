import React from "react";
import { beforeEach, afterEach, describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { setApiKey } from "./apiAuth";
import { PENDING_VM_JOB_KEY } from "./pendingVmJob";
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
  let state: "queued" | "running" | "succeeded" | "failed" | "unknown";
  let lost: boolean;
  let pollingFailure: "network" | "server" | null;
  let storage: Map<string, string>;
  let fetchMock: ReturnType<typeof jest.fn>;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_HOST = "http://127.0.0.1:3001";
    storage = new Map<string, string>();
    Object.defineProperty(global, "window", {
      configurable: true, value: { dispatchEvent: () => true },
    });
    Object.defineProperty(global, "sessionStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => { storage.set(key, value); },
        removeItem: (key: string) => { storage.delete(key); },
      },
    });
    setApiKey("test-key");
    vms = [source()];
    state = "queued";
    lost = false;
    pollingFailure = null;
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
      if (path === "/v1/jobs/job-1") {
        if (pollingFailure === "network") throw new TypeError("Network unavailable");
        if (pollingFailure === "server")
          return json({ error: { code: "unavailable", message: "Restarting" } }, 503);
        return lost
          ? json({ error: { code: "not_found", message: "Job not found" } }, 404)
          : json({ id: "job-1", state,
            ...(state === "failed"
              ? { error: { code: "unavailable", message: "UTM is unavailable" } }
              : state === "unknown"
                ? { error: { code: "outcome_unknown", message: "Inspect VM state" } }
              : { result: { vmId: COPY_ID } }) });
      }
      return json({ error: { code: "not_found", message: "Unknown route" } }, 404);
    });
    global.fetch = fetchMock as typeof fetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
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
    expect(JSON.parse(storage.get(PENDING_VM_JOB_KEY)!)).toEqual({
      jobId: "job-1", vmId: ID, action: "clone",
    });
    expect(storage.get(PENDING_VM_JOB_KEY)).not.toContain("test-key");
    state = "running";
    await store.pollJob();
    expect(store.getSnapshot().actionJob?.state).toBe("running");
    vms.push({ ...source(), id: COPY_ID, name: "Copy" });
    state = "succeeded";
    await store.pollJob();
    expect(store.getSnapshot().vms.map((vm) => vm.name)).toEqual(["Disposable VM", "Copy"]);
    expect(store.getSnapshot().selected?.id).toBe(ID);
    expect(store.getSnapshot().actionJob).toBeNull();
    expect(storage.has(PENDING_VM_JOB_KEY)).toBe(false);

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
    expect(storage.has(PENDING_VM_JOB_KEY)).toBe(false);
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
    expect(storage.has(PENDING_VM_JOB_KEY)).toBe(true);
    expect(fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith("/clone"))).toHaveLength(1);
  });

  it("resumes a clone after reload and authentication without posting it again", async () => {
    const beforeReload = await ready();
    await beforeReload.runManagement(ID, { action: "clone", name: "Copy" });
    const originalPostCount = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith("/clone")).length;
    const afterReload = new VmStore();
    expect(afterReload.getSnapshot().actionJob).toBeNull();
    await afterReload.resumePending();
    expect(afterReload.getSnapshot().selectedId).toBe(ID);
    expect(afterReload.getSnapshot().busyUuid).toBe(ID);
    expect(afterReload.getSnapshot().actionJob).toEqual({ action: "clone", state: "queued" });
    expect(fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith("/clone"))).toHaveLength(originalPostCount);
    vms.push({ ...source(), id: COPY_ID, name: "Copy" });
    state = "succeeded";
    await afterReload.pollJob();
    expect(afterReload.getSnapshot().vms.map((vm) => vm.name)).toContain("Copy");
    expect(storage.has(PENDING_VM_JOB_KEY)).toBe(false);
  });

  it.each(["network", "server"] as const)(
    "keeps the pending ID through a %s polling failure and retries after a bounded delay",
    async (failure) => {
      const clock = jest.spyOn(Date, "now").mockReturnValue(1000);
      const store = await ready();
      await store.runManagement(ID, { action: "delete", confirmName: "Disposable VM" });
      pollingFailure = failure;
      await store.pollJob();
      expect(store.getSnapshot().busyUuid).toBe(ID);
      expect(store.getSnapshot().actionError).toContain("Retrying shortly");
      expect(storage.has(PENDING_VM_JOB_KEY)).toBe(true);
      const polls = fetchMock.mock.calls.filter(([url]) => String(url).includes("/v1/jobs/"));
      await store.pollJob();
      expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/v1/jobs/")))
        .toHaveLength(polls.length);
      pollingFailure = null;
      state = "succeeded";
      vms = [];
      clock.mockReturnValue(3000);
      await store.pollJob();
      expect(store.getSnapshot().vms).toEqual([]);
      expect(store.getSnapshot().actionError).toBeNull();
      expect(storage.has(PENDING_VM_JOB_KEY)).toBe(false);
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE"))
        .toHaveLength(1);
    },
  );

  it.each(["unknown", "missing"] as const)(
    "refreshes VM state and asks for an outcome check for %s",
    async (outcome) => {
      const store = await ready();
      await store.runManagement(ID, { action: "clone", name: "Copy" });
      vms.push({ ...source(), id: COPY_ID, name: "Copy" });
      state = "unknown";
      lost = outcome === "missing";
      const detailCalls = fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith(`/v1/vms/${ID}`)).length;
      await store.pollJob();
      expect(store.getSnapshot().vms.map((vm) => vm.name)).toContain("Copy");
      expect(fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith(`/v1/vms/${ID}`)).length).toBeGreaterThan(detailCalls);
      expect(store.getSnapshot().actionError).toContain("confirm the outcome before trying again");
      expect(store.getSnapshot().actionJob).toBeNull();
      expect(storage.has(PENDING_VM_JOB_KEY)).toBe(true);
      await store.pollJob();
      expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/clone")))
        .toHaveLength(1);
      const afterReload = new VmStore();
      await afterReload.resumePending();
      expect(afterReload.getSnapshot().actionError).toContain("confirm the outcome before trying again");
      expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/clone")))
        .toHaveLength(1);
    },
  );
});
