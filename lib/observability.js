import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
const context = new AsyncLocalStorage();
export function logError(event, error) {
  // Never include SQL, headers, request bodies, URLs with query strings or exception messages.
  console.error(
    JSON.stringify({
      level: "error",
      event,
      requestId: context.getStore()?.id,
      errorType: error?.name || "Error",
      code: /^[A-Z0-9_]{1,40}$/.test(error?.code || "")
        ? error.code
        : undefined,
    }),
  );
}
export function traced(handler) {
  return async (req, args) => {
    const id = randomUUID(),
      start = Date.now();
    return context.run({ id }, async () => {
      let response;
      try {
        response = await handler(req, args);
      } catch (e) {
        logError("unhandled_request", e);
        response = Response.json(
          { error: "Ошибка сервера", requestId: id },
          { status: 500 },
        );
      }
      response.headers.set("X-Request-ID", id);
      if (response.status >= 500)
        console.error(
          JSON.stringify({
            level: "error",
            event: "request_failed",
            requestId: id,
            status: response.status,
            durationMs: Date.now() - start,
            method: req.method,
          }),
        );
      return response;
    });
  };
}
