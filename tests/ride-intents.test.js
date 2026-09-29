import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  localInstants,
  resolveLocal,
  quickWindows,
  windowDraft,
} from "../lib/ride-intent-time.js";
import { normalizeIntent, intentInput } from "../lib/ride-intent-input.js";
import {
  createIntent,
  updateIntent,
  closeIntent,
  listIntents,
  intentDetail,
  intentPreferences,
  saveIntentPreferences,
} from "../lib/ride-intents.js";
import { exportAccount } from "../lib/account-data.js";
const body = (
  date = new Date(Date.now() + 86400000).toISOString().slice(0, 10),
) => ({
  readiness: "considering",
  timeZone: "Europe/Moscow",
  windows: [{ startLocal: date + "T10:00", endLocal: date + "T15:00" }],
  passport: {
    area: { label: "Парк", center: [37.123456, 55.654321], radiusM: 3000 },
    purpose: "social",
  },
});
test("availability windows: UTC, midnight, DST gaps/folds, half-hour shifts and quick dates", () => {
  assert.equal(
    resolveLocal("2026-09-30T00:30", "Europe/Moscow"),
    "2026-09-29T21:30:00.000Z",
  );
  assert.deepEqual(localInstants("2027-03-28T02:30", "Europe/Berlin"), []);
  assert.throws(
    () => resolveLocal("2027-03-28T02:30", "Europe/Berlin"),
    /не существует/,
  );
  assert.deepEqual(localInstants("2026-10-25T02:30", "Europe/Berlin"), [
    "2026-10-25T00:30:00.000Z",
    "2026-10-25T01:30:00.000Z",
  ]);
  assert.throws(
    () => resolveLocal("2026-10-25T02:30", "Europe/Berlin"),
    /повторяется/,
  );
  assert.equal(
    resolveLocal("2026-10-25T02:30", "Europe/Berlin", "later"),
    "2026-10-25T01:30:00.000Z",
  );
  assert.equal(
    localInstants("2027-04-04T01:45", "Australia/Lord_Howe").length,
    2,
  );
  assert.throws(() => localInstants("2026-02-30T10:00", "UTC"));
  assert.throws(() => localInstants("2026-10-01T10:00", "+03:00"));
  const fold = {
    startsAt: "2026-10-25T01:30:00Z",
    endsAt: "2026-10-25T03:30:00Z",
  };
  assert.equal(windowDraft(fold, "Europe/Berlin").startFold, "later");
  const tonight = quickWindows(
    "tonight",
    "Europe/Moscow",
    new Date("2026-09-29T22:00Z"),
  );
  assert.equal(tonight[0].startLocal, "2026-09-30T18:00");
  assert.deepEqual(
    quickWindows("tonight", "Europe/Moscow", new Date("2026-09-29T20:00Z")),
    [],
  );
  const weekend = quickWindows(
    "weekend",
    "Europe/Moscow",
    new Date("2026-10-04T09:00Z"),
  );
  assert.equal(weekend.length, 1);
  assert.equal(weekend[0].startLocal, "2026-10-04T12:00");
});
test("strict intent contract: mandatory basics, optional unknowns, limits and full availability", () => {
  const now = new Date("2026-09-29T09:00Z"),
    base = body("2026-10-01");
  const parsed = normalizeIntent(base, now);
  assert.equal(parsed.visibility, "private");
  assert.equal(parsed.allowSuggestions, false);
  assert.equal(parsed.passport.pace, undefined);
  assert.deepEqual(parsed.passport.area.center, [37.12, 55.65]);
  assert.equal(parsed.windows[0].endsAt, "2026-10-01T12:00:00.000Z");
  const overnight = normalizeIntent(
    {
      ...base,
      windows: [
        { startLocal: "2026-10-01T23:00", endLocal: "2026-10-02T02:00" },
      ],
    },
    now,
  );
  assert.equal(
    +new Date(overnight.windows[0].endsAt) -
      +new Date(overnight.windows[0].startsAt),
    3 * 3600000,
  );
  for (const change of [
    { passport: {} },
    { passport: { area: { label: "Парк" } } },
    { windows: [] },
    { windows: Array(5).fill(base.windows[0]) },
    { windows: [base.windows[0], base.windows[0]] },
    {
      windows: [
        { startLocal: "2026-10-01T16:00", endLocal: "2026-10-01T15:00" },
      ],
    },
    {
      windows: [
        { startLocal: "2026-10-01T10:00", endLocal: "2026-10-02T11:00" },
      ],
    },
    {
      windows: [
        { startLocal: "2026-09-28T10:00", endLocal: "2026-09-28T15:00" },
      ],
    },
    {
      windows: [
        { startLocal: "2027-01-01T10:00", endLocal: "2027-01-01T15:00" },
      ],
    },
    { passport: { ...base.passport, durationMinutes: { min: 301, max: 400 } } },
    { timeZone: "No/Such_Zone" },
    { repeats: true },
  ])
    assert.throws(() => normalizeIntent({ ...base, ...change }, now));
  assert.equal(
    intentInput.safeParse({ ...base, visibility: "friends" }).success,
    false,
  );
});
test("intent DB: independent of garage, ownership, visibility/expiry, quotas, retry tombstones and account lifecycle", async () => {
  const db = new PGlite();
  try {
    for (const file of (await readdir(new URL("../db/", import.meta.url)))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await db.exec(
        await readFile(new URL("../db/" + file, import.meta.url), "utf8"),
      );
    const owner = randomUUID(),
      other = randomUUID();
    for (const [i, id] of [owner, other].entries())
      await db.query(
        "INSERT INTO users(id,email,name,password_hash,username) VALUES($1,$2,'Rider','hash',$3)",
        [id, id + "@test.invalid", "intent" + i],
      );
    const tx = (fn) => db.transaction(fn),
      input = { ...body(), requestId: randomUUID() };
    const first = await tx((q) => createIntent(q, owner, input));
    const id = first.intent.id;
    assert.equal(first.created, true);
    assert.equal(first.intent.own, true);
    assert.equal(
      (await tx((q) => createIntent(q, owner, input))).created,
      false,
    );
    await assert.rejects(
      tx((q) => createIntent(q, owner, { ...input, readiness: "ready" })),
      { status: 409 },
    );
    await assert.rejects(intentDetail(db, null, id), { status: 404 });
    await assert.rejects(intentDetail(db, other, id), { status: 404 });
    assert.equal((await listIntents(db, other, { own: false })).total, 0);
    const visible = {
      ...body(),
      visibility: "community",
      allowSuggestions: true,
    };
    await tx((q) => updateIntent(q, owner, id, visible));
    const viewed = await intentDetail(db, other, id);
    assert.equal(viewed.own, false);
    assert.equal(viewed.allowSuggestions, undefined);
    assert.equal(viewed.author.email, undefined);
    assert.equal((await listIntents(db, other, { own: false })).total, 1);
    await assert.rejects(
      tx((q) => updateIntent(q, other, id, visible)),
      { status: 404 },
    );
    await assert.rejects(
      tx((q) => closeIntent(q, other, id, true)),
      { status: 404 },
    );
    await tx((q) => updateIntent(q, owner, id, body()));
    await assert.rejects(intentDetail(db, other, id), { status: 404 });
    await tx((q) => updateIntent(q, owner, id, visible));
    await db.query("UPDATE users SET blocked=true WHERE id=$1", [owner]);
    await assert.rejects(intentDetail(db, other, id), { status: 404 });
    assert.equal((await listIntents(db, other, { own: false })).total, 0);
    await assert.rejects(
      tx((q) => createIntent(q, owner, { ...input, requestId: randomUUID() })),
      { status: 401 },
    );
    await db.query("UPDATE users SET blocked=false WHERE id=$1", [owner]);
    const prefs = {
      passport: { area: { label: "Preference Park" }, pace: "relaxed" },
      meetNewPeople: true,
    };
    await tx((q) => saveIntentPreferences(q, owner, prefs));
    assert.deepEqual(await intentPreferences(db, other), { passport: {} });
    assert.deepEqual(await intentPreferences(db, owner), prefs);
    assert.equal((await intentDetail(db, owner, id)).passport.pace, undefined);
    for (let i = 0; i < 4; i++)
      await tx((q) =>
        createIntent(q, owner, { ...body(), requestId: randomUUID() }),
      );
    await assert.rejects(
      tx((q) => createIntent(q, owner, { ...body(), requestId: randomUUID() })),
      { status: 409 },
    );
    await db.query(
      "UPDATE ride_intent_windows SET starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour' WHERE intent_id=$1",
      [id],
    );
    assert.equal((await intentDetail(db, owner, id)).status, "expired");
    await assert.rejects(intentDetail(db, other, id), { status: 404 });
    assert.equal((await listIntents(db, other, { own: false })).total, 0);
    const replacement = await tx((q) =>
      createIntent(q, owner, { ...body(), requestId: randomUUID() }),
    );
    await tx((q) => closeIntent(q, owner, replacement.intent.id));
    assert.equal(
      (await intentDetail(db, owner, replacement.intent.id)).status,
      "cancelled",
    );
    await assert.rejects(
      tx((q) => updateIntent(q, owner, replacement.intent.id, body())),
      { status: 409 },
    );
    const exported = await exportAccount(db, owner, "https://test.invalid");
    assert.equal(exported.rideIntents.length, 6);
    assert.deepEqual(exported.rideIntentPreferences, prefs);
    await tx((q) => closeIntent(q, owner, id, true));
    await tx((q) => closeIntent(q, owner, id, true));
    await assert.rejects(
      tx((q) => closeIntent(q, owner, id)),
      { status: 404 },
    );
    await assert.rejects(
      tx((q) => createIntent(q, owner, input)),
      { status: 409 },
    );
    assert.equal(
      (
        await db.query(
          "SELECT count(*) FROM ride_intent_windows WHERE intent_id=$1",
          [id],
        )
      ).rows[0].count,
      0,
    );
    assert.deepEqual(
      (await db.query("SELECT passport FROM ride_intents WHERE id=$1", [id]))
        .rows[0].passport,
      {},
    );
    for (const table of [
      "rides",
      "ride_rsvps",
      "ride_invitations",
      "journal_entries",
    ]) {
      assert.equal(
        Number((await db.query("SELECT count(*) FROM " + table)).rows[0].count),
        0,
      );
    }
    await db.query("DELETE FROM users WHERE id=$1", [owner]);
    assert.equal(
      Number(
        (await db.query("SELECT count(*) FROM ride_intents")).rows[0].count,
      ),
      0,
    );
    assert.deepEqual(await intentPreferences(db, owner), { passport: {} });
  } finally {
    await db.close();
  }
});
