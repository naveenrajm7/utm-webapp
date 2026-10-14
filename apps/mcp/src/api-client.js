const DEFAULT_URL = "http://127.0.0.1:3001";

export class ApiError extends Error {
  constructor(code, message, status, details) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    if (status !== undefined) this.status = status;
    if (details !== undefined) this.details = details;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      ...(this.status === undefined ? {} : { status: this.status }),
      ...(this.details === undefined ? {} : { details: this.details }),
    };
  }
}

function localBaseUrl(value) {
  let url;
  try {
    url = new URL(value || DEFAULT_URL);
  } catch {
    throw new ApiError("configuration", "UTM_API_URL must be a local HTTP URL");
  }

  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new ApiError("configuration", "UTM_API_URL must be a loopback HTTP origin");
  }
  return url;
}

function httpError(status, body) {
  const upstream = body && typeof body === "object" ? body.error : undefined;
  const code =
    typeof upstream === "object" && typeof upstream?.code === "string"
      ? upstream.code
      : typeof upstream === "string"
        ? upstream
        : ({ 401: "unauthorized", 403: "forbidden", 404: "not_found", 409: "conflict", 422: "invalid_request", 501: "unsupported" }[status] || "api_error");
  const message =
    (typeof upstream === "object" && typeof upstream?.message === "string" && upstream.message) ||
    (typeof body?.message === "string" && body.message) ||
    `API returned HTTP ${status}`;
  const details = typeof upstream === "object" ? upstream?.details : body?.details;
  return new ApiError(code, message, status, details);
}

export function createApiClient({ baseUrl = DEFAULT_URL, apiKey, fetchImpl = fetch, timeoutMs = 30_000 } = {}) {
  const origin = localBaseUrl(baseUrl);
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    throw new ApiError("configuration", "UTM_API_KEY is required");
  }

  async function request(method, path, body) {
    let response;
    try {
      response = await fetchImpl(new URL(path, origin), {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      throw new ApiError("unavailable", "Cannot reach the local UTM API", undefined, {
        reason: cause?.name === "TimeoutError" ? "timeout" : "connection_failed",
      });
    }

    let data;
    try {
      data = await response.json();
    } catch {
      throw new ApiError("invalid_response", "API did not return JSON", response.status);
    }
    if (!response.ok) throw httpError(response.status, data);
    if (data === null || typeof data !== "object") {
      throw new ApiError("invalid_response", "API returned an invalid result", response.status);
    }
    return data;
  }

  return {
    listVms: () => request("GET", "/v1/vms"),
    listTemplates: () => request("GET", "/v1/templates"),
    createSandbox: ({ templateId, network, ttlSeconds }) =>
      request("POST", "/v1/sandboxes", { templateId, network, ttlSeconds }),
    runCommand: ({ sandboxId, argv, timeoutSeconds }) =>
      request("POST", `/v1/sandboxes/${encodeURIComponent(sandboxId)}/exec`, {
        argv,
        ...(timeoutSeconds === undefined ? {} : { timeoutSeconds }),
      }),
    getJob: ({ jobId }) => request("GET", `/v1/jobs/${encodeURIComponent(jobId)}`),
    destroySandbox: ({ sandboxId }) => request("DELETE", `/v1/sandboxes/${encodeURIComponent(sandboxId)}`),
  };
}
