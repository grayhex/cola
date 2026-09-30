// Browser error reports for the server log and the optional tracker.
// At most five distinct reports per page load; failures are ignored.
const seen = new Set();
let sent = 0;
const ignored =
  /ResizeObserver loop|Script error\.?$|Load failed|NetworkError|Failed to fetch/i;

export function reportClientError(error: unknown, kind = "error") {
  try {
    if (typeof window === "undefined" || sent >= 5) return;
    const details =
      error !== null &&
      (typeof error === "object" || typeof error === "function")
        ? (error as Record<string, unknown>)
        : {};
    if (details.name === "AbortError") return;
    const message = String(details.message ?? error ?? "").slice(0, 1000);
    const stack =
      typeof details.stack === "string" ? details.stack.slice(0, 8000) : null;
    // Extensions and cross-origin scripts are outside the application.
    if (ignored.test(message) || /-extension:\/\//.test(stack || "")) return;
    const key = kind + "|" + message + "|" + (stack || "").slice(0, 300);
    if (seen.has(key)) return;
    seen.add(key);
    sent++;
    fetch("/api/client-errors", {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind,
        message,
        stack,
        digest: typeof details.digest === "string" ? details.digest : null,
        path: window.location.pathname,
      }),
    }).catch(() => {});
  } catch {
    // Error reporting itself must never interrupt the page.
  }
}

export function installErrorReporting() {
  const onError = (event: ErrorEvent) =>
    reportClientError(event.error || event.message, "error");
  const onRejection = (event: PromiseRejectionEvent) =>
    reportClientError(event.reason, "unhandledrejection");
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
