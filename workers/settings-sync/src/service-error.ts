import { ProtocolError } from "./protocol.ts";

export class ServiceError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  constructor(code: string, status: number, retryable = false) {
    super(code);
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}
export function serviceError(error: unknown): ServiceError {
  if (error instanceof ServiceError) return error;
  if (error instanceof ProtocolError) {
    const status =
      error.code === "INVALID_DOCUMENT"
        ? 400
        : error.code === "UNSUPPORTED_VERSION"
          ? 426
          : error.code === "PAYLOAD_TOO_LARGE"
            ? 413
            : [
                  "REFERENCE_NOT_FOUND",
                  "DUPLICATE_ENTITY",
                  "ENTITY_NOT_FOUND",
                  "ENTITY_DELETED",
                ].includes(error.code)
              ? 409
              : 422;
    return new ServiceError(error.code, status);
  }
  return new ServiceError("INTERNAL_ERROR", 500, true);
}
