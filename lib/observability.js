import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { reportError } from "./error-tracker.js";
const context = new AsyncLocalStorage();

// Logs keep code locations and error text, but never request bodies, headers,
// SQL or values that identify people: emails, IPs, tokens/IDs and quoted values.
const patterns = [
  [/[^\s@"'<>(),;:]+@[^\s@"'<>(),;:]+\.[a-z]{2,}/gi, "[email]"],
  [/(https?:\/\/[^\s?#"'<>]+)[?#][^\s"'<>]*/gi, "$1?[query]"],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[id]"],
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[ip]"],
  [/\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{20,}\b/g, "[token]"],
];
export function scrub(text, max = 300) {
  let value = String(text ?? "");
  for (const [pattern, replacement] of patterns)
    value = value.replace(pattern, replacement);
  // PostgreSQL quotes both identifiers and input values: keep only identifiers.
  value = value.replace(/"([^"]*)"/g, (all, inner) =>
    /^[a-z_][a-z0-9_]{0,62}$/.test(inner) ? all : '"[value]"',
  );
  return value.length > max ? value.slice(0, max) + "…" : value;
}

const root = process.cwd();
// V8 frames ("at fn (file:1:2)") and browser frames ("fn@https://…/file.js:1:2").
export function stackFrames(stack, limit = 12) {
  return String(stack ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^at\s/.test(line) || /@.*:\d+:\d+\)?$/.test(line))
    .slice(0, limit)
    .map((line) =>
      line
        .replace(/^at\s+/, "")
        .replaceAll("file://", "")
        .replaceAll(root + "/", "")
        .replace(/https?:\/\/[^/\s)]+/g, "")
        .replace(/\?[^\s:)]*/g, "")
        .slice(0, 240),
    );
}

export function errorDetails(error) {
  const details = {
    errorType: error?.name || "Error",
    code: /^[A-Z0-9_]{1,40}$/.test(error?.code || "") ? error.code : undefined,
    message: scrub(error?.message ?? (typeof error === "string" ? error : "")),
    stack: stackFrames(error?.stack),
  };
  if (error?.cause instanceof Error)
    details.cause = {
      errorType: error.cause.name || "Error",
      message: scrub(error.cause.message),
    };
  return details;
}

export function logError(event, error) {
  const store = context.getStore();
  const record = {
    level: "error",
    event,
    requestId: store?.id,
    route: store?.route,
    ...errorDetails(error),
  };
  console.error(JSON.stringify(record));
  reportError(record);
}

// Paths without query strings; IDs, tokens and numbers become placeholders.
export function routeTemplate(value) {
  let pathname;
  try {
    pathname = new URL(value, "http://route.local").pathname;
  } catch {
    return "/";
  }
  return (
    pathname
      .split("/")
      .map((segment) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          segment,
        )
          ? ":id"
          : /^\d+$/.test(segment)
            ? ":n"
            : segment.length > 40 || /[^\w.@~-]/.test(segment)
              ? ":param"
              : segment,
      )
      .join("/") || "/"
  );
}

function slowThreshold(env = process.env) {
  if (env.SLOW_REQUEST_MS === undefined || env.SLOW_REQUEST_MS === "")
    return 1000;
  const value = Number(env.SLOW_REQUEST_MS);
  // "0" disables the warning; invalid values keep the default.
  return Number.isFinite(value) && value >= 0 ? value || Infinity : 1000;
}

function withRequestId(response, id) {
  try {
    response.headers.set("X-Request-ID", id);
    return response;
  } catch {
    // fetch()/redirect responses have immutable headers.
    const copy = new Response(response.body, response);
    copy.headers.set("X-Request-ID", id);
    return copy;
  }
}

export function traced(handler) {
  return async (req, args) => {
    const id = randomUUID(),
      start = Date.now(),
      route = routeTemplate(req.url);
    return context.run({ id, route }, async () => {
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
      response = withRequestId(response, id);
      const durationMs = Date.now() - start;
      const summary = {
        requestId: id,
        route,
        method: req.method,
        status: response.status,
        durationMs,
      };
      if (response.status >= 500)
        console.error(
          JSON.stringify({ level: "error", event: "request_failed", ...summary }),
        );
      else if (durationMs >= slowThreshold())
        console.warn(
          JSON.stringify({ level: "warn", event: "slow_request", ...summary }),
        );
      return response;
    });
  };
}

export function currentRequestId() {
  return context.getStore()?.id;
}
