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
  state: "queued" | "running" | "succeeded" | "failed" | "unknown";
  result?:
    | { stdout?: string; stderr?: string; exitCode?: number }
    | Record<string, unknown>;
  error?: { code?: string; message?: string } | string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

const errorDetails = (data: unknown, fallback: string): { message: string; code?: string } => {
  if (!data || typeof data !== "object") return { message: fallback };
  const record = data as {
    error?: string | { message?: string; code?: string };
    message?: string;
  };
  if (typeof record.error === "string") return { message: record.error };
  if (record.error && typeof record.error === "object")
    return { message: record.error.message || fallback, code: record.error.code };
  return { message: record.message || fallback };
};

export const requestJson = async <T>(
  path: string,
  init?: RequestInit,
): Promise<T> => {
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set("Content-Type", "application/json");
  const response = await apiFetch(path, { ...init, headers });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = errorDetails(data, `Request failed (${response.status})`);
    throw new ApiError(error.message, response.status, error.code);
  }
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
export type VmSettingsPatch = {
  name?: string;
  memoryMiB?: number;
  cpuCores?: number;
};
export const cloneVm = (id: string, name: string) =>
  requestJson<{ jobId: string }>(`${vmPath(id)}/clone`, {
    method: "POST", body: JSON.stringify({ name }),
  });
export const configureVm = (id: string, patch: VmSettingsPatch) =>
  requestJson<{ jobId: string }>(vmPath(id), {
    method: "PATCH", body: JSON.stringify(patch),
  });
export const deleteVm = (id: string, confirmName: string) =>
  requestJson<{ jobId: string }>(vmPath(id), {
    method: "DELETE", body: JSON.stringify({ confirmName }),
  });
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

export const jobError = (job: Job): string => {
  if (typeof job.error === "string") return job.error;
  const message = job.error?.message || "The job failed.";
  return job.error?.code ? `${job.error.code}: ${message}` : message;
};

export const actionErrorMessage = (caught: unknown, fallback: string): string => {
  if (caught instanceof ApiError)
    return caught.code ? `${caught.code}: ${caught.message}` : caught.message;
  return caught instanceof Error ? caught.message : fallback;
};
