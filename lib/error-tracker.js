import { randomUUID } from "node:crypto";
import { appVersion } from "./version.js";

// Sentry-compatible envelope API (Sentry, self-hosted GlitchTip). Optional:
// without ERROR_TRACKER_DSN errors stay in the structured container log only.
export function parseDsn(value) {
  if (!value) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const parts = url.pathname.split("/").filter(Boolean);
  const project = parts.pop();
  if (
    !["https:", "http:"].includes(url.protocol) ||
    !url.username ||
    !/^\d+$/.test(project || "")
  )
    return null;
  const prefix = parts.length ? "/" + parts.join("/") : "";
  return {
    key: decodeURIComponent(url.username),
    endpoint: `${url.protocol}//${url.host}${prefix}/api/${project}/envelope/`,
    secure: url.protocol === "https:",
  };
}

// "fn (file:line:col)" / "fn@file:line:col" / "file:line:col" -> Sentry frame.
function frame(line) {
  const match =
    /^(?:(.*?)\s+\()?(.+?):(\d+):(\d+)\)?$/.exec(line) ||
    /^(.*?)@(.+?):(\d+):(\d+)$/.exec(line);
  if (!match) return { function: line.slice(0, 120) };
  return {
    function: match[1] || "?",
    filename: match[2],
    lineno: Number(match[3]),
    colno: Number(match[4]),
    in_app: !/node_modules|node:internal/.test(match[2]),
  };
}

export function trackerEvent(report, now = new Date(), env = process.env) {
  const frames = (report.stack || []).map(frame).reverse();
  return {
    event_id: randomUUID().replaceAll("-", ""),
    timestamp: now.toISOString(),
    platform: report.source === "browser" ? "javascript" : "node",
    level: report.level || "error",
    logger: "colabike",
    release: `colabike@${appVersion.version}+${appVersion.build}`,
    environment:
      env.DEPLOYMENT_MODE === "production"
        ? "production"
        : env.NODE_ENV || "development",
    tags: {
      event: report.event,
      source: report.source || "server",
      ...(report.route ? { route: report.route } : {}),
      ...(report.requestId ? { request_id: report.requestId } : {}),
      ...(report.code ? { code: report.code } : {}),
    },
    exception: {
      values: [
        {
          type: report.errorType || "Error",
          value: report.message || report.event,
          ...(frames.length ? { stacktrace: { frames } } : {}),
        },
      ],
    },
  };
}

export function envelopeBody(event, now = new Date()) {
  return [
    JSON.stringify({ event_id: event.event_id, sent_at: now.toISOString() }),
    JSON.stringify({ type: "event" }),
    JSON.stringify(event),
  ].join("\n");
}

// A burst of identical failures must not flood the tracker or the network.
const budget = { windowStart: 0, sent: 0, dropped: 0 };
const perMinute = 30;
function allow(now = Date.now()) {
  if (now - budget.windowStart >= 60000) {
    if (budget.dropped)
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "error_tracker_dropped",
          dropped: budget.dropped,
        }),
      );
    Object.assign(budget, { windowStart: now, sent: 0, dropped: 0 });
  }
  if (budget.sent >= perMinute) {
    budget.dropped++;
    return false;
  }
  budget.sent++;
  return true;
}

// Fire-and-forget. Never throws and never logs through logError (no recursion).
export function reportError(report, env = process.env) {
  const dsn = parseDsn(env.ERROR_TRACKER_DSN);
  if (!dsn || !allow()) return null;
  const event = trackerEvent(report, new Date(), env);
  return fetch(dsn.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-sentry-envelope",
      "X-Sentry-Auth": `Sentry sentry_version=7, sentry_client=colabike/${appVersion.version}, sentry_key=${dsn.key}`,
    },
    body: envelopeBody(event),
    signal: AbortSignal.timeout(3000),
  })
    .then((response) => {
      if (!response.ok)
        console.warn(
          JSON.stringify({
            level: "warn",
            event: "error_tracker_rejected",
            status: response.status,
          }),
        );
      return response.ok;
    })
    .catch(() => {
      console.warn(
        JSON.stringify({ level: "warn", event: "error_tracker_unreachable" }),
      );
      return false;
    });
}
