import { db } from "../../../../../lib/db.ts";
import { fail, json } from "../../../../../lib/http.ts";
import {
  SIGNUP_COOKIE,
  readFlowCookie,
} from "../../../../../lib/identity-http.ts";
import { readPendingSignup } from "../../../../../lib/identities.ts";
import { traced } from "../../../../../lib/observability.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// What the first-sign-in form may prefill: the Yandex name and, when Yandex
// gave one, the address. Only the browser holding the cookie can read it.
export const GET = traced(async function GET() {
  const pending = await readPendingSignup(
    db,
    await readFlowCookie(SIGNUP_COOKIE),
  );
  if (!pending)
    return fail("Время входа истекло. Войдите через Яндекс заново.", 404);
  return json({ name: pending.name, email: pending.email });
});
