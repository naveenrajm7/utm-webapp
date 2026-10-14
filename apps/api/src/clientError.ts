/** Only API-authored errors may supply client-facing text. Adapter output stays local. */
export class ClientError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

const messages: Record<string, string> = {
  invalid_input: "Invalid request",
  invalid_argument: "Invalid argument",
  not_managed: "VM is not managed",
  unavailable: "UTM is unavailable",
  timeout: "UTM operation timed out; refresh inventory before retrying",
  command_failed: "UTM command failed",
  protocol_error: "UTM returned an invalid response",
  output_limit: "UTM output exceeded the limit",
  utm_failure: "UTM operation failed",
  not_found: "VM not found",
  unsupported: "Operation is unavailable",
  conflict: "VM operation conflicts with current state",
  unauthorized: "Unauthorized",
  service_unavailable: "Service is unavailable",
  internal: "Internal server error",
  outcome_unknown: "API interrupted; inspect refreshed VM state before another action",
};

export const clientError = (error: unknown): { code: string; message: string } => {
  const candidate = error as { code?: unknown } | null;
  const code = typeof candidate?.code === "string" &&
    Object.prototype.hasOwnProperty.call(messages, candidate.code)
    ? candidate.code : "internal";
  return {
    code,
    message: error instanceof ClientError ? error.message : messages[code]!,
  };
};

/** Journal records from older releases may contain raw adapter messages. */
export const publicJobError = (error: unknown): { code: string; message: string } => {
  const safe = clientError(error);
  return { code: safe.code, message: messages[safe.code]! };
};
