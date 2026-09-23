import { z } from "zod";
import { rateLimit } from "../../../lib/auth.js";
import { trustedIp } from "../../../lib/auth-limits.js";
import { fail, readJson, sameOrigin } from "../../../lib/http.js";
import { digest } from "../../../lib/password.js";
import { reportError } from "../../../lib/error-tracker.js";
import {
  currentRequestId,
  routeTemplate,
  scrub,
  stackFrames,
  traced,
} from "../../../lib/observability.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const report = z
  .object({
    kind: z.enum(["boundary", "error", "unhandledrejection"]),
    message: z.string().max(1000).default(""),
    stack: z.string().max(8000).nullable().default(null),
    digest: z.string().max(100).nullable().default(null),
    path: z.string().max(500).default("/"),
  })
  .strict();

// Browser errors from error boundaries and window handlers. The page path is
// kept without query; message and frames are scrubbed like server errors.
export const POST = traced(async function POST(req) {
  if (!sameOrigin(req)) return fail("Недопустимый источник запроса", 403);
  const ip = trustedIp(req);
  if (
    (ip && !(await rateLimit("client-errors:ip:" + digest(ip), 30))) ||
    !(await rateLimit("client-errors:global", 600))
  )
    return fail("Слишком много отчётов", 429);
  let input;
  try {
    input = report.parse(await readJson(req, 16384));
  } catch {
    return fail("Некорректный отчёт об ошибке");
  }
  const record = {
    level: "error",
    event: "client_error",
    source: "browser",
    requestId: currentRequestId(),
    route: routeTemplate(input.path),
    kind: input.kind,
    errorType: "BrowserError",
    message: scrub(input.message),
    stack: stackFrames(input.stack),
    ...(input.digest && /^[\w-]{1,100}$/.test(input.digest)
      ? { digest: input.digest }
      : {}),
  };
  console.error(JSON.stringify(record));
  reportError(record);
  return new Response(null, { status: 204 });
});
