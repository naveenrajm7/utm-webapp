import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import VMActionControls from "./components/VMActionControls";
import VMList from "./components/VMList";
import { setApiKey } from "./apiAuth";
import {
  createSandbox,
  destroySandbox,
  executeSandbox,
  getJob,
  getSandbox,
  getVm,
  listTemplates,
  listVms,
  powerVm,
} from "./v1";
import type { VM } from "./vm";

const VM_ID = "12345678-1234-1234-1234-123456789abc";
const vm: VM = {
  id: VM_ID,
  name: "Disposable template",
  status: "stopped",
  backend: "qemu",
  network: "offline",
  memoryMiB: 2048,
  cpuCores: 2,
  capabilities: { start: true, stop: false, guestExec: false },
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("the documented /v1 client", () => {
  let fetchMock: ReturnType<typeof jest.fn>;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_HOST = "http://127.0.0.1:3001";
    const values = new Map<string, string>();
    Object.defineProperty(global, "window", {
      configurable: true,
      value: { dispatchEvent: () => true },
    });
    Object.defineProperty(global, "sessionStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
          values.set(key, value);
        },
        removeItem: (key: string) => {
          values.delete(key);
        },
      },
    });
    setApiKey("test-key");
    fetchMock = jest.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      const path = url.pathname;
      if (path === "/v1/vms") return json([vm]);
      if (path === `/v1/vms/${VM_ID}` && init?.method !== "POST")
        return json(vm);
      if (path === `/v1/vms/${VM_ID}/start`) return json({ jobId: "power-1" });
      if (path === "/v1/templates")
        return json([{ id: VM_ID, name: "Disposable template" }]);
      if (path === "/v1/sandboxes" && init?.method === "POST")
        return json({ sandboxId: "sb-1", jobId: "clone-1" });
      if (path === "/v1/sandboxes/sb-1" && init?.method === "DELETE")
        return json({ jobId: "destroy-1" });
      if (path === "/v1/sandboxes/sb-1/exec") return json({ jobId: "exec-1" });
      if (path === "/v1/sandboxes/sb-1")
        return json({
          id: "sb-1",
          state: "ready",
          vmId: VM_ID,
          leaseExpiresAt: "2026-10-10T20:00:00Z",
        });
      if (path.startsWith("/v1/jobs/"))
        return json({
          id: path.split("/").pop(),
          state: "succeeded",
          result: { stdout: "Linux", stderr: "", exitCode: 0 },
        });
      return json(
        { error: { code: "not_found", message: "Unknown route" } },
        404,
      );
    });
    global.fetch = fetchMock as typeof fetch;
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_API_HOST;
    Reflect.deleteProperty(global, "window");
    Reflect.deleteProperty(global, "sessionStorage");
  });

  it("lists VMs, runs an asynchronous power action, and completes the managed sandbox flow", async () => {
    expect(await listVms()).toEqual([vm]);
    expect(await getVm(VM_ID)).toEqual(vm);
    expect(await powerVm(VM_ID, "start")).toEqual({ jobId: "power-1" });
    expect((await getJob("power-1")).state).toBe("succeeded");
    expect(await listTemplates()).toEqual([
      { id: VM_ID, name: "Disposable template" },
    ]);
    expect(await createSandbox(VM_ID, "offline", 3600)).toEqual({
      sandboxId: "sb-1",
      jobId: "clone-1",
    });
    expect((await getJob("clone-1")).state).toBe("succeeded");
    expect((await getSandbox("sb-1")).state).toBe("ready");
    expect(await executeSandbox("sb-1", ["/bin/uname", "-a"])).toEqual({
      jobId: "exec-1",
    });
    expect((await getJob("exec-1")).result).toEqual({
      stdout: "Linux",
      stderr: "",
      exitCode: 0,
    });
    expect(await destroySandbox("sb-1")).toEqual({ jobId: "destroy-1" });
    expect((await getJob("destroy-1")).state).toBe("succeeded");

    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(
      calls.every(
        ([url, init]) =>
          url.includes("/v1/") &&
          new Headers(init.headers).get("Authorization") === "Bearer test-key",
      ),
    ).toBe(true);
    expect(
      JSON.parse(
        String(calls.find(([url]) => url.endsWith("/v1/sandboxes"))?.[1].body),
      ),
    ).toEqual({
      templateId: VM_ID,
      network: "offline",
      ttlSeconds: 3600,
    });
    expect(
      JSON.parse(
        String(calls.find(([url]) => url.endsWith("/exec"))?.[1].body),
      ),
    ).toEqual({
      argv: ["/bin/uname", "-a"],
    });
  });

  it("surfaces structured API errors", async () => {
    fetchMock.mockResolvedValueOnce(
      json(
        {
          error: {
            code: "unsupported",
            message: "Guest execution unavailable",
          },
        },
        409,
      ),
    );
    await expect(executeSandbox("sb-1", ["/bin/true"])).rejects.toThrow(
      "Guest execution unavailable",
    );
  });
});

describe("capability-based VM actions", () => {
  it("shows only supported console and power actions", () => {
    const consoleVm = {
      ...vm,
      capabilities: { ...vm.capabilities, serial: true, display: false },
    };
    const html = renderToStaticMarkup(
      React.createElement(VMActionControls, {
        vm: consoleVm,
        busy: false,
        onAction: () => {},
      }),
    );
    expect(html).toContain("Open serial console");
    expect(html).toContain("Start virtual machine");
    expect(html).not.toContain("Open display");
    expect(html).not.toContain("Stop virtual machine");

    const list = renderToStaticMarkup(
      React.createElement(VMList, {
        vms: [vm],
        loading: false,
        error: null,
        selectedUUID: null,
        busyUuid: null,
        onSelectVM: () => {},
        onAction: () => {},
        onRetry: () => {},
      }),
    );
    expect(list).toContain("Disposable template");
    expect(list).toContain("Start Disposable template");
  });
});
