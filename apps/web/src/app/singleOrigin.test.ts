import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { apiFetch, getAuthenticatedWebSocketUrl, getWebSocketProtocols, setApiKey } from "./apiAuth";

describe("production browser URLs", () => {
  const originalApiHost = process.env.NEXT_PUBLIC_API_HOST;
  let fetchMock: ReturnType<typeof jest.fn>;

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_API_HOST;
    const storage = new Map<string, string>();
    Object.defineProperty(global, "window", { configurable: true,
      value: { location: { origin: "http://127.0.0.1:45678" }, dispatchEvent: () => true } });
    Object.defineProperty(global, "sessionStorage", { configurable: true,
      value: { getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => { storage.set(key, value); },
        removeItem: (key: string) => { storage.delete(key); } } });
    setApiKey("local-key");
    fetchMock = jest.fn(async () => new Response("{}", { status: 200 }));
    global.fetch = fetchMock as typeof fetch;
  });

  afterEach(() => {
    if (originalApiHost === undefined) delete process.env.NEXT_PUBLIC_API_HOST;
    else process.env.NEXT_PUBLIC_API_HOST = originalApiHost;
    Reflect.deleteProperty(global, "window");
    Reflect.deleteProperty(global, "sessionStorage");
  });

  it("uses a relative REST path and page origin for serial and VNC", async () => {
    await apiFetch("/v1/vms");
    const [path, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/v1/vms");
    expect(new Headers(options.headers).get("Authorization")).toBe("Bearer local-key");
    expect(getAuthenticatedWebSocketUrl("/ws/serial", { vmUUID: "vm-id" }))
      .toBe("ws://127.0.0.1:45678/ws/serial?vmUUID=vm-id");
    expect(getAuthenticatedWebSocketUrl("/ws/vnc", { vmUUID: "vm-id" }))
      .toBe("ws://127.0.0.1:45678/ws/vnc?vmUUID=vm-id");
    expect(getWebSocketProtocols()).toHaveLength(2);
    expect(getWebSocketProtocols()[0]).toBe("utm-auth");
    expect(getWebSocketProtocols(true)[0]).toBe("binary");
    expect(getWebSocketProtocols(true)[1]).toBe("utm-auth");
    expect(getWebSocketProtocols(true)[2]).toMatch(/^utm-auth\./);
  });
});
