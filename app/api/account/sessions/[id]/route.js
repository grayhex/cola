import {
  currentSessionHash,
  currentUser,
  endSession,
} from "../../../../../lib/auth.js";
import { db, transaction } from "../../../../../lib/db.js";
import { fail, json, sameOrigin } from "../../../../../lib/http.js";
import { uuid } from "../../../../../lib/validation.js";
import { endSessionById } from "../../../../../lib/account-data.js";
import { traced } from "../../../../../lib/observability.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ends one session of the account; ending this browser's signs it out.
export const DELETE = traced(async function DELETE(req, { params }) {
  if (!sameOrigin(req)) return fail("Недопустимый источник запроса", 403);
  const user = await currentUser();
  if (!user) return fail("Войдите в аккаунт", 401);
  const { id } = await params;
  if (!uuid.safeParse(id).success) return fail("Сеанс не найден", 404);
  const hash = await currentSessionHash();
  const current = (
    await db.query("SELECT 1 FROM sessions WHERE id=$1 AND token_hash=$2", [
      id,
      hash,
    ])
  ).rowCount;
  const ended = await transaction((q) => endSessionById(q, user.id, id));
  if (!ended) return fail("Сеанс не найден", 404);
  if (current) await endSession();
  return json({ ok: true, current: !!current });
});
