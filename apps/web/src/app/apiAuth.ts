import { getApiHost, getApiWebSocketHost } from "./config";

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
  const headers = new Headers(init?.headers);
  const key = getApiKey();
  if (key) {
    headers.set("Authorization", `Bearer ${key}`);
  }

  const response = await fetch(`${getApiHost()}${path}`, { ...init, headers });

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

  const key = getApiKey();
  if (key) {
    url.searchParams.set("token", key);
  }

  return url.toString();
};
