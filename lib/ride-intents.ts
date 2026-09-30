import type { Queryable } from "./db.ts";
import type { IntentWindow } from "./ride-intent-time.ts";
import type { z } from "zod";
interface IntentViewRow {
  id: string;
  owner_id: string;
  readiness: "ready" | "considering";
  time_zone: string;
  passport: z.infer<typeof intentInput>["passport"];
  windows: IntentWindow[];
  meet_new_people: boolean | null;
  visibility: "private" | "community";
  status: "active" | "cancelled" | "deleted";
  expired: boolean;
  allow_suggestions: boolean;
  name: string;
  username: string;
  avatar_id: string | null;
  created_at: Date;
  updated_at: Date;
}
import { createHash } from "node:crypto";
import { publicAuthor } from "./profile-dto.ts";
import {
  IntentError,
  createIntentInput,
  intentInput,
  intentPreferencesInput,
  normalizeIntent,
} from "./ride-intent-input.ts";
import { intentLimits } from "./ride-intent-time.ts";

const activeWindow =
  "EXISTS (SELECT 1 FROM ride_intent_windows w WHERE w.intent_id=i.id AND w.ends_at>now())";
const visible = `NOT u.blocked AND i.status<>'deleted' AND EXISTS (SELECT 1 FROM users v WHERE v.id=$1 AND NOT v.blocked)
  AND (i.owner_id=$1 OR (i.visibility='community' AND i.status='active' AND ${activeWindow}))`;
const select = `SELECT i.*,u.name,u.username,u.avatar_id,
  (i.status='active' AND NOT ${activeWindow}) AS expired,
  (SELECT coalesce(jsonb_agg(jsonb_build_object('startsAt',w.starts_at,'endsAt',w.ends_at) ORDER BY w.starts_at),'[]')
   FROM ride_intent_windows w WHERE w.intent_id=i.id AND (i.owner_id=$1 OR w.ends_at>now())) AS windows
  FROM ride_intents i JOIN users u ON u.id=i.owner_id`;
function dto(row: IntentViewRow, viewerId: string) {
  const own = row.owner_id === viewerId;
  return {
    id: row.id,
    own,
    readiness: row.readiness,
    timeZone: row.time_zone,
    passport: row.passport,
    windows: row.windows.map((w) => ({
      startsAt: new Date(w.startsAt).toISOString(),
      endsAt: new Date(w.endsAt).toISOString(),
    })),
    ...(row.meet_new_people === null
      ? {}
      : { meetNewPeople: row.meet_new_people }),
    visibility: row.visibility,
    status: row.expired ? "expired" : row.status,
    ...(own ? { allowSuggestions: row.allow_suggestions } : {}),
    author: publicAuthor({
      id: row.owner_id,
      name: row.name,
      username: row.username,
      avatar_id: row.avatar_id,
    }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
async function lockOwner(q: Queryable, ownerId: string) {
  const r = await q.query<{ id: string }>(
    "SELECT id FROM users WHERE id=$1 AND NOT blocked FOR UPDATE",
    [ownerId],
  );
  if (!r.rows.length) throw new IntentError("Войдите в аккаунт", 401);
}
export async function intentDetail(q: Queryable, viewerId: string, id: string) {
  const r = await q.query<IntentViewRow>(
    `${select} WHERE i.id=$2 AND ${visible}`,
    [viewerId, id],
  );
  if (!r.rows[0]) throw new IntentError("Намерение недоступно", 404);
  return dto(r.rows[0], viewerId);
}
export async function listIntents(
  q: Queryable,
  viewerId: string,
  { own = true, page = 1 } = {},
) {
  const where = `${visible} AND ${own ? "i.owner_id=$1" : `i.visibility='community' AND i.status='active' AND ${activeWindow}`}`;
  const args = [viewerId];
  const total = Number(
    (
      await q.query<{ count: string }>(
        `SELECT count(*) FROM ride_intents i JOIN users u ON u.id=i.owner_id WHERE ${where}`,
        args,
      )
    ).rows[0].count,
  );
  const r = await q.query<IntentViewRow>(
    `${select} WHERE ${where} ORDER BY i.created_at DESC,i.id LIMIT 20 OFFSET $2`,
    [viewerId, (page - 1) * 20],
  );
  return {
    items: r.rows.map((r) => dto(r, viewerId)),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / 20)),
  };
}
async function checkLimit(
  q: Queryable,
  ownerId: string,
  except: string | null = null,
) {
  const r = await q.query<{ count: string }>(
    `SELECT count(*) FROM ride_intents i WHERE i.owner_id=$1 AND i.status='active' AND ($2::uuid IS NULL OR i.id<>$2) AND ${activeWindow}`,
    [ownerId, except],
  );
  if (Number(r.rows[0].count) >= intentLimits.active)
    throw new IntentError(
      "Можно иметь не больше 5 активных намерений. Отмените одно из них.",
      409,
    );
}
async function writeWindows(q: Queryable, id: string, windows: IntentWindow[]) {
  await q.query("DELETE FROM ride_intent_windows WHERE intent_id=$1", [id]);
  for (const w of windows)
    await q.query(
      "INSERT INTO ride_intent_windows(intent_id,starts_at,ends_at) VALUES($1,$2,$3)",
      [id, w.startsAt, w.endsAt],
    );
}
// The user lock serializes quota checks, writes and deletion. Call writers inside a transaction.
export async function createIntent(
  q: Queryable,
  ownerId: string,
  input: unknown,
) {
  const { requestId, ...body } = createIntentInput.parse(input);
  const hash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  await lockOwner(q, ownerId);
  const old = (
    await q.query<{ owner_id: string; status: string; request_hash: string }>(
      "SELECT owner_id,status,request_hash FROM ride_intents WHERE id=$1",
      [requestId],
    )
  ).rows[0];
  if (old) {
    if (old.owner_id !== ownerId)
      throw new IntentError("Намерение недоступно", 404);
    if (old.status === "deleted" || old.request_hash !== hash)
      throw new IntentError(
        "Этот запрос уже использован. Обновите список перед новым действием.",
        409,
      );
    return {
      intent: await intentDetail(q, ownerId, requestId),
      created: false,
    };
  }
  const value = normalizeIntent(body);
  await checkLimit(q, ownerId);
  await q.query(
    `INSERT INTO ride_intents(id,owner_id,readiness,time_zone,passport,meet_new_people,visibility,allow_suggestions,request_hash)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      requestId,
      ownerId,
      value.readiness,
      value.timeZone,
      JSON.stringify(value.passport),
      value.meetNewPeople ?? null,
      value.visibility,
      value.allowSuggestions,
      hash,
    ],
  );
  await writeWindows(q, requestId, value.windows);
  return { intent: await intentDetail(q, ownerId, requestId), created: true };
}
export async function updateIntent(
  q: Queryable,
  ownerId: string,
  id: string,
  input: unknown,
) {
  await lockOwner(q, ownerId);
  const old = await intentDetail(q, ownerId, id);
  if (!old.own) throw new IntentError("Намерение недоступно", 404);
  if (old.status === "cancelled")
    throw new IntentError(
      "Отменённое намерение можно повторить с новыми датами",
      409,
    );
  const value = normalizeIntent(intentInput.parse(input));
  await checkLimit(q, ownerId, id);
  await q.query(
    `UPDATE ride_intents SET readiness=$3,time_zone=$4,passport=$5,meet_new_people=$6,visibility=$7,allow_suggestions=$8,updated_at=now() WHERE id=$1 AND owner_id=$2`,
    [
      id,
      ownerId,
      value.readiness,
      value.timeZone,
      JSON.stringify(value.passport),
      value.meetNewPeople ?? null,
      value.visibility,
      value.allowSuggestions,
    ],
  );
  await writeWindows(q, id, value.windows);
  return intentDetail(q, ownerId, id);
}
export async function closeIntent(
  q: Queryable,
  ownerId: string,
  id: string,
  remove = false,
) {
  await lockOwner(q, ownerId);
  const r = await q.query<{ id: string }>(
    `UPDATE ride_intents SET status=$3,visibility='private',allow_suggestions=false,updated_at=now()
    WHERE id=$1 AND owner_id=$2 AND (status<>'deleted' OR $3='deleted') RETURNING id`,
    [id, ownerId, remove ? "deleted" : "cancelled"],
  );
  if (!r.rows.length) throw new IntentError("Намерение недоступно", 404);
  if (remove) {
    // Keep only the retry tombstone, not deleted schedules or preferences.
    await q.query("DELETE FROM ride_intent_windows WHERE intent_id=$1", [id]);
    await q.query(
      "UPDATE ride_intents SET passport='{}',time_zone='UTC',meet_new_people=NULL,readiness='considering' WHERE id=$1",
      [id],
    );
  }
  return { ok: true };
}
export async function intentPreferences(q: Queryable, ownerId: string) {
  const r = await q.query<{ value: z.infer<typeof intentPreferencesInput> }>(
    "SELECT p.value FROM ride_intent_preferences p JOIN users u ON u.id=p.owner_id WHERE u.id=$1 AND NOT u.blocked",
    [ownerId],
  );
  return r.rows[0]?.value || { passport: {} };
}
export async function saveIntentPreferences(
  q: Queryable,
  ownerId: string,
  input: unknown,
) {
  const value = intentPreferencesInput.parse(input);
  await lockOwner(q, ownerId);
  await q.query(
    "INSERT INTO ride_intent_preferences(owner_id,value) VALUES($1,$2) ON CONFLICT(owner_id) DO UPDATE SET value=$2,updated_at=now()",
    [ownerId, JSON.stringify(value)],
  );
  return value;
}
