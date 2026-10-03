import type { ZodError } from "zod";

// The error envelope of /api/v1 (#134): a stable machine-readable `code` that
// clients branch on, and a message for people. Never an SQL or stack detail.

export const apiErrorCodes = [
  "invalid_request",
  "unauthorized",
  "unsupported_authentication",
  "ambiguous_authentication",
  "invalid_credentials",
  "token_expired",
  "invalid_token",
  "forbidden",
  "email_verification_required",
  "not_found",
  "method_not_allowed",
  "conflict",
  "precondition_failed",
  "precondition_required",
  "payload_too_large",
  "unsupported_media_type",
  "rate_limited",
  "internal_error",
  "service_unavailable",
] as const;
export type ApiErrorCode = (typeof apiErrorCodes)[number];

export const errorStatus: Record<ApiErrorCode, number> = {
  invalid_request: 400,
  unauthorized: 401,
  unsupported_authentication: 401,
  ambiguous_authentication: 400,
  invalid_credentials: 401,
  token_expired: 401,
  invalid_token: 401,
  forbidden: 403,
  email_verification_required: 403,
  not_found: 404,
  method_not_allowed: 405,
  conflict: 409,
  precondition_failed: 412,
  precondition_required: 428,
  payload_too_large: 413,
  unsupported_media_type: 415,
  rate_limited: 429,
  internal_error: 500,
  service_unavailable: 503,
};

export interface ErrorDetail {
  path: string;
  message: string;
}

export class ApiError extends Error {
  declare code: ApiErrorCode;
  declare details: ErrorDetail[] | undefined;
  declare headers: Record<string, string> | undefined;
  constructor(
    code: ApiErrorCode,
    message: string,
    extra: { details?: ErrorDetail[]; headers?: Record<string, string> } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.details = extra.details;
    this.headers = extra.headers;
  }
}

/** Zod issues as client-readable details: where, and what is wrong. */
export function detailsOf(error: ZodError): ErrorDetail[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

export const notFound = (message: string) => new ApiError("not_found", message);

/** The `WWW-Authenticate` challenge of RFC 6750 for a refused Bearer token. */
export const bearerChallenge = (description?: string) => ({
  "WWW-Authenticate":
    'Bearer error="invalid_token"' +
    (description ? `, error_description="${description}"` : ""),
});
