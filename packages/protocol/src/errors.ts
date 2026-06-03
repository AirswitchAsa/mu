/**
 * Typed errors — the agent-safe failure vocabulary (index.dog.md "Acquisition
 * failures"). Every external/untrusted failure is converted to one of these at a
 * single boundary (the coordinator for data, the driver for opencode); raw vendor
 * errors never reach the agent's context.
 */
export type MuErrorCode =
  // acquisition
  | "UNKNOWN_SOURCE"
  | "NOT_CONFIGURED"
  | "SOURCE_UNAVAILABLE"
  | "RATE_LIMITED"
  | "FETCH_FAILED"
  // broker
  | "VALIDATION_FAILED"
  | "HANDLE_NOT_FOUND"
  | "SLICE_TOO_BROAD";

export interface MuError {
  readonly code: MuErrorCode;
  readonly message: string;
}

/** Carries a {@link MuError} as a throwable while keeping the typed code intact. */
export class MuErrorException extends Error {
  readonly code: MuErrorCode;
  constructor(code: MuErrorCode, message: string) {
    super(message);
    this.name = "MuErrorException";
    this.code = code;
  }
  toMuError(): MuError {
    return { code: this.code, message: this.message };
  }
}
