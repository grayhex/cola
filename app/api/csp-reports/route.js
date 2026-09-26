import { rateLimit } from "../../../lib/auth.js";
import { trustedIp } from "../../../lib/auth-limits.js";
import { digest } from "../../../lib/password.js";
import { readJson, fail } from "../../../lib/http.js";
import { cspReports } from "../../../lib/csp-reports.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req) {
  const origin = process.env.APP_ORIGIN || "http://localhost:3000";
  const suppliedOrigin = req.headers.get("origin");
  let referrerOrigin;
  try { referrerOrigin = new URL(req.headers.get("referer")).origin; } catch { /* absent */ }
  const sameSite = req.headers.get("sec-fetch-site") === "same-origin";
  // WebKit sends CSP reports with Origin: null. Require BOTH browser signals
  // for that case; an explicit foreign origin is still always rejected.
  const allowed = suppliedOrigin === "null"
    ? sameSite && referrerOrigin === origin
    : suppliedOrigin ? suppliedOrigin === origin : sameSite || referrerOrigin === origin;
  if (!allowed)
    return fail("Недопустимый источник отчёта", 403);
  const type = req.headers.get("content-type")?.split(";")[0].trim();
  if (!["application/csp-report", "application/reports+json"].includes(type)) return fail("Недопустимый формат отчёта", 415);
  const ip = trustedIp(req);
  if ((ip && !(await rateLimit("csp:ip:" + digest(ip), 30))) || !(await rateLimit("csp:global", 120)))
    return fail("Слишком много отчётов", 429);
  let reports;
  try { reports = cspReports(await readJson(req, 16384), origin); }
  catch { return fail("Некорректный CSP-отчёт", 400); }
  for (const report of reports) {
    // Deduplicate across workers in the existing DB rate limiter, not unbounded memory.
    if (await rateLimit("csp:event:" + digest(JSON.stringify(report)), 1))
      console.warn(JSON.stringify({ level: "warn", event: "csp_violation", ...report }));
  }
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
