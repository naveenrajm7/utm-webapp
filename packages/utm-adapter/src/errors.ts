export type UtmErrorCode =
  | "invalid_input"
  | "not_found"
  | "conflict"
  | "unsupported"
  | "unavailable"
  | "timeout"
  | "output_limit"
  | "command_failed"
  | "protocol_error";

export class UtmError extends Error {
  readonly code: UtmErrorCode;
  readonly operation: string;
  readonly cause?: unknown;

  constructor(code: UtmErrorCode, operation: string, message: string, cause?: unknown) {
    super(message);
    this.name = "UtmError";
    this.code = code;
    this.operation = operation;
    this.cause = cause;
  }
}
