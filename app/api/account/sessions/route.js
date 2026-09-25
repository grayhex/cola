import {
  currentSessionHash,
  currentUser,
  endSession,
} from "../../../../lib/auth.js";
import { db, transaction } from "../../../../lib/db.js";
import { fail, json, sameOrigin } from "../../../../lib/http.js";
import { endAllSessions, listSessions } from "../../../../lib/account-data.js";
import { traced } from "../../../../lib/observability.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Signed-in devices of the account (#70).
export const GET = traced(async function GET() {
  const user = await currentUser();
  if (!user) return fail("Войдите в аккаунт", 401);
  return json({
    sessions: await listSessions(db, user.id, await currentSessionHash()),
  });
});

// «Sign out everywhere»: this browser included.
export const DELETE = traced(async function DELETE(req) {
  if (!sameOrigin(req)) return fail("Недопустимый источник запроса", 403);
  const user = await currentUser();
  if (!user) return fail("Войдите в аккаунт", 401);
  await transaction((q) => endAllSessions(q, user.id));
  await endSession();
  return json({ ok: true });
});
