// #235 races on real PostgreSQL: PGlite's single session cannot hold two
// transactions at once. Runs in the HTTP CI group against its disposable DB.
import assert from "node:assert/strict";
import pg from "pg";
import { randomUUID } from "node:crypto";
import {
  cancelPlannedRide,
  planInput,
  planRide,
  respondRide,
  rideDefaults,
  rideEdit,
  saveRide,
  setRideRecruitment,
} from "../lib/rides.js";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 8,
  statement_timeout: 10000,
});
async function tx(fn) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const result = await fn(c);
    await c.query("COMMIT");
    return result;
  } catch (error) {
    await c.query("ROLLBACK");
    throw error;
  } finally {
    c.release();
  }
}
/** An owner mutation that keeps its transaction (and row locks) open until
 * `commit()`, so another request provably waits for it. */
async function hold(fn) {
  const c = await pool.connect();
  await c.query("BEGIN");
  try {
    await fn(c);
  } catch (error) {
    await c.query("ROLLBACK");
    c.release();
    throw error;
  }
  return async () => {
    await c.query("COMMIT");
    c.release();
  };
}
const settled = (promise) =>
  promise.then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error }),
  );
const pending = async (promise) =>
  (await Promise.race([
    promise.then(() => "done"),
    new Promise((r) => setTimeout(() => r("waiting"), 300)),
  ])) === "waiting";

const nonce = randomUUID().slice(0, 8);
async function user(name) {
  const id = randomUUID();
  await pool.query(
    "INSERT INTO users(id,email,name,password_hash,username) VALUES($1,$2,$3,'hash',$4)",
    [id, id + "@example.test", name, name.toLowerCase() + nonce],
  );
  return id;
}
const owner = await user("org"),
  rider = await user("rider"),
  newcomer = await user("late"),
  invitee = await user("inv");
const bike = randomUUID();
await pool.query(
  "INSERT INTO bikes(id,owner_id,share_id,name,year,category,is_public) VALUES($1,$2,$1,'Race bike',2026,'gravel',true)",
  [bike, owner],
);
const startAt = new Date(
  Math.ceil((Date.now() + 50 * 3600000) / 60000) * 60000,
).toISOString();
const base = {
  bikeId: bike,
  title: "Гонка " + nonce,
  description: "",
  isPublic: true,
  privacyEnabled: false,
  privacyRadiusM: 500,
  scheduledAt: startAt,
  recurrenceTimezone: "Europe/Moscow",
  meetingPoint: "Кафе у станции",
  meetingVisibility: "participants",
};
const plan = (fields = {}) =>
  tx((q) =>
    planRide(q, owner, planInput.parse({ ...base, ...fields }), rideDefaults),
  );
const edit = (q, id, fields) =>
  saveRide(q, owner, rideEdit.parse({ ...base, ...fields }), rideDefaults, id);
const answer = (id, person, response, at = startAt) =>
  tx((q) => respondRide(q, id, person, response, at));
const rows = async (id, person) =>
  (
    await pool.query(
      "SELECT response,revision FROM ride_rsvps WHERE ride_id=$1 AND user_id=$2",
      [id, person],
    )
  ).rows;
try {
  // 1. Double clicks and quick changes: one row per person and date, no
  // deadlock, the last committed answer wins.
  const open = await plan();
  const people = [rider, newcomer, invitee];
  const results = await Promise.all(
    people.flatMap((p) => [
      settled(answer(open.id, p, "accepted")),
      settled(answer(open.id, p, "declined")),
      settled(answer(open.id, p, "accepted")),
    ]),
  );
  assert.ok(
    results.every((r) => r.ok),
    results.find((r) => !r.ok)?.error?.message,
  );
  for (const p of people) {
    const stored = await rows(open.id, p);
    assert.equal(stored.length, 1);
    assert.ok(["accepted", "declined"].includes(stored[0].response));
  }

  // 2. An answer that waits for a substantial edit belongs to the new
  // edition, never to the old one.
  const commitEdit = await hold((q) =>
    edit(q, open.id, { meetingPoint: "Главный вход в парк" }),
  );
  const late = answer(open.id, rider, "maybe");
  assert.equal(await pending(late), true, "the answer waits for the edit");
  await commitEdit();
  await late;
  const { agreement_revision: revision } = (
    await pool.query("SELECT agreement_revision FROM rides WHERE id=$1", [
      open.id,
    ])
  ).rows[0];
  assert.equal(revision, 2);
  assert.deepEqual(await rows(open.id, rider), [
    { response: "maybe", revision: 2 },
  ]);

  // 3. Closing the recruitment while a newcomer answers: the newcomer waits
  // and is refused; people already in are unaffected.
  const fresh = await user("fresh");
  const commitClose = await hold((q) =>
    setRideRecruitment(q, open.id, owner, false, startAt),
  );
  const refused = settled(answer(open.id, fresh, "accepted"));
  assert.equal(await pending(refused), true);
  await commitClose();
  const outcome = await refused;
  assert.equal(outcome.ok, false);
  assert.equal(outcome.error.status, 409);
  assert.deepEqual(await rows(open.id, fresh), []);
  await answer(open.id, rider, "accepted");

  // 4. Revoking an invitation while the invitee answers: after both, the
  // invitee has neither access nor an answer.
  const closed = await plan({ isPublic: false, invitations: ["inv" + nonce] });
  const commitRevoke = await hold((q) =>
    edit(q, closed.id, { isPublic: false, invitations: [] }),
  );
  const revoked = settled(answer(closed.id, invitee, "accepted"));
  assert.equal(await pending(revoked), true);
  await commitRevoke();
  const revokedOutcome = await revoked;
  assert.equal(revokedOutcome.ok, false);
  assert.equal(revokedOutcome.error.status, 404);
  assert.deepEqual(await rows(closed.id, invitee), []);

  // 5. Cancelling one date of a series while someone answers that date: the
  // answer is refused as stale; the series goes on.
  const series = await plan({ recurrence: "weekly" });
  const commitCancel = await hold((q) =>
    cancelPlannedRide(q, series.id, owner, startAt),
  );
  const stale = settled(answer(series.id, rider, "accepted"));
  assert.equal(await pending(stale), true);
  await commitCancel();
  const staleOutcome = await stale;
  assert.equal(staleOutcome.ok, false);
  assert.equal(staleOutcome.error.status, 409);
  const nextAt = new Date(+new Date(startAt) + 7 * 24 * 3600000).toISOString();
  await answer(series.id, rider, "accepted", nextAt);
  assert.equal(
    (await pool.query("SELECT status FROM rides WHERE id=$1", [series.id]))
      .rows[0].status,
    "planned",
  );
  console.log(
    "Ride agreements concurrency: double answers, edit vs answer, closing, revoking and a cancelled date passed",
  );
} finally {
  await pool.end();
}
