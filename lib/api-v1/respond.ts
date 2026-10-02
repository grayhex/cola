import { logError } from "../observability.ts";
import { ApiError, errorStatus } from "./errors.ts";

// JSON responses of /api/v1 (#134). Nothing here is cached: an answer depends
// on who asks, and a stale one could outlive a sign-out or a block.

const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

export function ok(
  data: unknown,
  status = 200,
  extra: Record<string, string> = {},
) {
  return Response.json(data, { status, headers: { ...headers, ...extra } });
}

export function errorResponse(error: ApiError) {
  return ok(
    {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    },
    errorStatus[error.code],
    error.headers,
  );
}

/**
 * Runs a handler and turns every failure into the error envelope. An expected
 * ApiError keeps its code; anything else is logged with its request id and
 * answered as internal_error, without the cause.
 */
export async function safely(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    logError("api_v1_error", error);
    return errorResponse(
      new ApiError(
        "internal_error",
        "Не удалось выполнить запрос. Попробуйте ещё раз.",
      ),
    );
  }
}

/** A handler for methods a path does not support. */
export function methodNotAllowed(allow: string) {
  return () =>
    safely(async () => {
      throw new ApiError(
        "method_not_allowed",
        "Этот метод здесь не поддерживается.",
        {
          headers: { Allow: allow },
        },
      );
    });
}
