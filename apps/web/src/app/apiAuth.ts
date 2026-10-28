import { getApiHost, getApiWebSocketHost } from "./config";
import { IS_DEMO } from "./demo";

let sessionCsrf: string | undefined;
let sessionMode = false;
export const useSessionAuth = (csrf?: string) => { sessionMode = true; sessionCsrf = csrf; };
export const useApiKeyAuth = () => { sessionMode = false; sessionCsrf = undefined; };
export const logout = async () => {
  if (sessionMode) {
    const response = await apiFetch("/auth/logout", { method: "POST" });
    if (!response.ok && response.status !== 401) throw new Error("Could not log out. Please try again.");
    sessionCsrf = undefined;
  }
  clearApiKey();
};

const STORAGE_KEY = "utm-api-key";
export const API_KEY_CHANGED_EVENT = "utm-api-key-changed";

const notifyApiKeyChanged = () => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(API_KEY_CHANGED_EVENT));
  }
};

export const getApiKey = (): string | null => {
  if (typeof window === "undefined") {
    return null;
  }

  return sessionStorage.getItem(STORAGE_KEY);
};

export const setApiKey = (key: string) => {
  sessionStorage.setItem(STORAGE_KEY, key);
  notifyApiKeyChanged();
};

export const clearApiKey = () => {
  if (typeof window === "undefined") {
    return;
  }

  sessionStorage.removeItem(STORAGE_KEY);
  notifyApiKeyChanged();
};

export const apiFetch = async (path: string, init?: RequestInit): Promise<Response> => {
  if (IS_DEMO) {
    const { demoFetch } = await import("./demo/mockApi");
    return demoFetch(path, init);
  }

  const headers = new Headers(init?.headers);
  const key = sessionMode ? null : getApiKey();
  headers.set("X-UTM-Request", "1");
  if (sessionCsrf) headers.set("X-UTM-CSRF", sessionCsrf);
  if (key) {
    headers.set("Authorization", `Bearer ${key}`);
  }

  const response = await fetch(`${getApiHost()}${path}`, { ...init, headers, credentials: "include" });

  if (response.status === 401) {
    clearApiKey();
  }

  return response;
};

export const getAuthenticatedWebSocketUrl = (
  path: string,
  params: Record<string, string>,
): string => {
  const url = new URL(path, `${getApiWebSocketHost()}/`);

  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, value);
  }

  return url.toString();
};

/** Browser WebSocket APIs cannot set Authorization headers; carry the key in a handshake subprotocol. */
export const getWebSocketProtocols = (includeBinary = false): string[] => {
  const protocols = includeBinary ? ["binary"] : [];
  const key = sessionMode ? null : getApiKey();
  if (key) {
    protocols.push("utm-auth");
    const bytes = new TextEncoder().encode(key);
    let binary = "";
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    protocols.push(`utm-auth.${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`);
  }
  return protocols;
};
