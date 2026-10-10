import { apiFetch } from "./apiAuth";
import type { VM, VmAction } from "./vm";

export interface Template {
  id: string;
  name: string;
  backend?: string;
}

export interface Sandbox {
  id: string;
  templateId?: string;
  vmId?: string | null;
  name?: string;
  state?: string;
  status?: string;
  leaseExpiresAt?: string;
  expiresAt?: string;
  capabilities?: Record<string, unknown>;
}

export interface Job {
  id: string;
  state: "queued" | "running" | "succeeded" | "failed";
  result?:
    | { stdout?: string; stderr?: string; exitCode?: number }
    | Record<string, unknown>;
  error?: { code?: string; message?: string } | string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const errorMessage = (data: unknown, fallback: string): string => {
  if (!data || typeof data !== "object") return fallback;
  const record = data as {
    error?: string | { message?: string; code?: string };
    message?: string;
  };
  if (typeof record.error === "string") return record.error;
  if (record.error && typeof record.error.message === "string")
    return record.error.message;
  return record.message || fallback;
};

export const requestJson = async <T>(
  path: string,
  init?: RequestInit,
): Promise<T> => {
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set("Content-Type", "application/json");
  const response = await apiFetch(path, { ...init, headers });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiError(
      errorMessage(data, `Request failed (${response.status})`),
      response.status,
    );
  if (data === null)
    throw new Error("The API returned an empty or invalid response.");
  return data as T;
};

const vmPath = (id: string): string => `/v1/vms/${encodeURIComponent(id)}`;
const sandboxPath = (id: string): string =>
  `/v1/sandboxes/${encodeURIComponent(id)}`;

export const listVms = () => requestJson<VM[]>("/v1/vms");
export const getVm = (id: string) => requestJson<VM>(vmPath(id));
export const powerVm = (id: string, action: VmAction) =>
  requestJson<{ jobId: string }>(`${vmPath(id)}/${action}`, { method: "POST" });
export const listTemplates = () => requestJson<Template[]>("/v1/templates");
export const createSandbox = (
  templateId: string,
  network: "offline" | "shared",
  ttlSeconds: number,
) =>
  requestJson<{ sandboxId: string; jobId: string }>("/v1/sandboxes", {
    method: "POST",
    body: JSON.stringify({ templateId, network, ttlSeconds }),
  });
export const getSandbox = (id: string) => requestJson<Sandbox>(sandboxPath(id));
export const executeSandbox = (id: string, argv: string[]) =>
  requestJson<{ jobId: string }>(`${sandboxPath(id)}/exec`, {
    method: "POST",
    body: JSON.stringify({ argv }),
  });
export const destroySandbox = (id: string) =>
  requestJson<{ jobId: string }>(sandboxPath(id), { method: "DELETE" });
export const getJob = (id: string) =>
  requestJson<Job>(`/v1/jobs/${encodeURIComponent(id)}`);

export const jobError = (job: Job): string =>
  typeof job.error === "string"
    ? job.error
    : job.error?.message || "The job failed.";
