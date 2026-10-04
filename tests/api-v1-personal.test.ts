import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { savedKeysetPage } from "../lib/journal-discovery.ts";
import { feedKeysetPage } from "../lib/ride-feed.ts";
import {
  noticeExpiringListings,
  savedApiKeysetPage,
  savedListings,
} from "../lib/market.ts";
import {
  inboxState,
  notificationKeysetPage,
  notificationPage,
  unreadCount,
} from "../lib/notifications.ts";
import { myUpcomingEntries, ownRideKeysetPage } from "../lib/rides.ts";
import { insertBike } from "../lib/repository.ts";
import { bikeInput } from "../lib/validation.ts";
import {
  toJournalSummary,
  toFeedItem,
  toMarketListing,
  toMyUpcomingRide,
  toNotification,
  toOwnRideSummary,
} from "../lib/api-v1/mappers.ts";
import {
  feedItemSchema,
  journalSummarySchema,
  marketListingSchema,
  notificationCountSchema,
  myUpcomingRidesSchema,
  notificationSchema,
  ownRideSummarySchema,
  parseNoQuery,
} from "../lib/api-v1/schemas.ts";
import { present } from "./support/assertions.ts";
import { testDatabase } from "./support/database.ts";
import { listingRow } from "./support/market.ts";
import {
  bikeCommentRow,
  journalEntryRow,
  noticeRow,
} from "./support/notifications.ts";
import { userRow } from "./support/people.ts";
import { rideRow, rsvpRow } from "./support/rides.ts";
import { one } from "./support/rows.ts";

// API v1, personal reads (#321): notices and saved items of the person asking.
// The rules are the site's (visibility at read time), only the paging differs.
// The server end to end is tests/api-v1-personal-http.js.

type FeedType = Parameters<typeof feedKeysetPage>[2]["type"];
type FeedCard = ReturnType<typeof toFeedItem>;
type Cursor = Awaited<ReturnType<typeof savedKeysetPage>>["next"];
const db = await testDatabase();
after(() => db.close());

const day = (n: number, micro = 100) =>
  `2026-09-${String(n).padStart(2, "0")}T10:00:00.${String(micro).padStart(6, "0")}Z`;
async function addUser(label: string, blocked = false) {
  const id = randomUUID();
  return (
    await userRow(db, {
      id,
      name: "Имя " + label,
      username: (label + "-" + id.slice(0, 8)).toLowerCase(),
      blocked,
    })
  ).id;
}
async function addBike(owner: string, isPublic = true) {
  return insertBike(
    db,
    owner,
    bikeInput.parse({
      name: "Bike " + randomUUID().slice(0, 6),
      brand: "Cube",
      model: "Nuroad",
      year: 2024,
      category: "gravel",
      description: "",
      color: "",
      size: "",
      weight: null,
      is_public: isPublic,
    }),
  );
}
async function addComment(bike: string, author: string, at: string) {
  return (
    await bikeCommentRow(db, bike, author, { created_at: at, updated_at: at })
  ).id;
}
async function notice(
  recipient: string,
  actor: string,
  type: string,
  extra: { bike?: string; comment?: string },
  at: string,
) {
  return (
    await noticeRow(db, recipient, type, {
      actor_id: actor,
      bike_id: extra.bike ?? null,
      comment_id: extra.comment ?? null,
      created_at: at,
    })
  ).id;
}
async function addListing(
  owner: string,
  {
    status = "active",
    at = day(10),
    title,
  }: { status?: "active" | "sold" | "draft"; at?: string; title?: string } = {},
) {
  return (
    await listingRow(db, owner, {
      title,
      price: 100,
      status,
      published_at: at,
      expires_at: status === "active" ? "2099-01-01T00:00:00Z" : null,
    })
  ).id;
}
async function addEntry(
  owner: string,
  bike: string,
  {
    status = "published",
    at = day(1),
  }: { status?: "draft" | "published"; at?: string } = {},
) {
  return (
    await journalEntryRow(db, owner, bike, {
      status,
      created_at: at,
      updated_at: at,
    })
  ).id;
}

const me = await addUser("me");
const actor = await addUser("actor");
const barred = await addUser("barred");
const bike = await addBike(me);
const their = await addBike(actor);

async function walk(limit: number) {
  const seen: string[] = [];
  let after: Awaited<ReturnType<typeof notificationKeysetPage>>["next"] = null;
  for (let guard = 0; guard < 30; guard++) {
    const page = await notificationKeysetPage(db, me, limit, after);
    seen.push(...page.items.map((item) => item.id));
    if (!page.next) return seen;
    after = page.next;
  }
  throw new Error("the walk does not end");
}

test("notices: the keyset walk is the site's order, ties and all", async () => {
  await db.query(
    "INSERT INTO user_follows(follower_id,following_id) VALUES($1,$2)",
    [actor, me],
  );
  const follow = await notice(me, actor, "follow", {}, day(1));
  const like = await notice(me, actor, "like", { bike }, day(2));
  await db.query("INSERT INTO bike_likes(bike_id,user_id) VALUES($1,$2)", [
    bike,
    actor,
  ]);
  const comment = await addComment(bike, actor, day(3));
  const first = await notice(me, actor, "comment", { bike, comment }, day(3));
  const comment2 = await addComment(bike, actor, day(3));
  // The same instant: the id is the last word.
  const second = await notice(
    me,
    actor,
    "comment",
    { bike, comment: comment2 },
    day(3),
  );
  const legacy = (await notificationPage(db, me, 1)).notifications.map(
    (n) => n.id,
  );
  assert.deepEqual(new Set(legacy), new Set([follow, like, first, second]));
  for (const limit of [1, 2, 3, 50])
    assert.deepEqual(await walk(limit), legacy, "limit " + limit);
  // Somebody else's notices are not ours.
  await notice(actor, me, "follow", {}, day(4));
  assert.deepEqual(await walk(50), legacy);
});

test("notices: what the person may no longer see is not shown", async () => {
  const page = async () =>
    (await notificationKeysetPage(db, me, 50, null)).items;
  const before = (await page()).map((item) => item.type).sort();
  assert.deepEqual(before, ["comment", "comment", "follow", "like"]);
  // An undone like leaves no notice.
  await db.query("DELETE FROM bike_likes WHERE bike_id=$1 AND user_id=$2", [
    bike,
    actor,
  ]);
  assert.ok(!(await page()).some((item) => item.type === "like"));
  await db.query("INSERT INTO bike_likes(bike_id,user_id) VALUES($1,$2)", [
    bike,
    actor,
  ]);
  // A private bike hides the notices about it.
  await db.query("UPDATE bikes SET is_public=false WHERE id=$1", [bike]);
  assert.deepEqual(
    (await page()).map((item) => item.type),
    ["follow"],
  );
  await db.query("UPDATE bikes SET is_public=true WHERE id=$1", [bike]);
  // A deleted comment leaves no notice.
  const [{ comment_id: gone }] = (
    await db.query(
      "SELECT comment_id FROM notifications WHERE recipient_id=$1 AND type='comment' AND comment_id IS NOT NULL ORDER BY created_at DESC,id LIMIT 1",
      [me],
    )
  ).rows;
  await db.query(
    "UPDATE bike_comments SET deleted_at=now(),body='' WHERE id=$1",
    [gone],
  );
  assert.equal(
    (await page()).filter((item) => item.type === "comment").length,
    1,
  );
  await db.query(
    "UPDATE bike_comments SET deleted_at=NULL,body='Привет' WHERE id=$1",
    [gone],
  );
  assert.equal((await page()).length, 4);
});

test("notices: the card is the contract's, with the site's paths", async () => {
  const items = (await notificationKeysetPage(db, me, 50, null)).items.map(
    toNotification,
  );
  for (const item of items) notificationSchema.parse(item);
  const byType = (type: string) =>
    present(items.find((item) => item.type === type));
  assert.equal(byType("follow").target.type, "profile");
  assert.match(byType("follow").target.path, /^\/@/);
  assert.equal(byType("like").target.type, "bike");
  assert.match(byType("like").target.path, /^\/b\//);
  assert.match(byType("comment").target.path, /\?comment=.+#discussion$/);
  assert.equal(
    present(byType("like").actor).username.startsWith("actor-"),
    true,
  );
  assert.ok(!JSON.stringify(items).includes("@test.invalid"));
  assert.ok(items.every((item) => item.readAt === null));
});

test("notices: the end of a listing's term and a security notice", async () => {
  const soon = await addListing(me, { title: "Скоро" });
  await db.query(
    "UPDATE market_listings SET expires_at=now()+interval '1 day' WHERE id=$1",
    [soon],
  );
  await noticeExpiringListings(db, me, false);
  await noticeExpiringListings(db, me, false);
  await db.query(
    "INSERT INTO notifications(id,recipient_id,actor_id,type,dedup_key,created_at) VALUES($1,$2,NULL,'session_reuse',$4,$3)",
    [randomUUID(), me, day(20), randomUUID()],
  );
  const items = (await notificationKeysetPage(db, me, 50, null)).items.map(
    toNotification,
  );
  for (const item of items) notificationSchema.parse(item);
  const market = items.filter((item) => item.type === "market_expiring");
  assert.equal(market.length, 1, "one notice per term");
  assert.equal(market[0].actor, null);
  assert.equal(market[0].target.state, "expiring");
  assert.ok(market[0].target.expiresAt);
  assert.equal(market[0].target.name, "Скоро");
  const reuse = present(items.find((item) => item.type === "session_reuse"));
  assert.equal(reuse.actor, null);
  assert.equal(reuse.target.type, "account");
  assert.match(reuse.target.path, /^\/account/);
});

test("the count is the site's", async () => {
  const count = await unreadCount(db, me);
  assert.equal(count.unread, 6);
  // What the API sends adds the mark to read up to (#341).
  notificationCountSchema.parse(await inboxState(db, me));
  await db.query(
    "UPDATE notifications SET read_at=now() WHERE recipient_id=$1 AND type='follow'",
    [me],
  );
  assert.equal((await unreadCount(db, me)).unread, 5);
});

test("saved entries: newest save first, only what is still public", async () => {
  const entries: string[] = [];
  for (let i = 0; i < 4; i++)
    entries.push(await addEntry(actor, their, { at: day(1 + i) }));
  const draft = await addEntry(actor, their, { status: "draft" });
  const save = (entry: string, at: string) =>
    db.query(
      "INSERT INTO journal_saves(user_id,entry_id,created_at) VALUES($1,$2,$3)",
      [me, entry, at],
    );
  const [e0, e1, e2, e3] = entries as [string, string, string, string];
  await save(e0, day(5));
  await save(e1, day(6));
  // The same instant: the id is the last word.
  await save(e2, day(7));
  await save(e3, day(7));
  await save(draft, day(8));
  const walk = async (limit: number) => {
    const seen: string[] = [];
    let after: Cursor = null;
    for (let guard = 0; guard < 20; guard++) {
      const page = await savedKeysetPage(db, me, limit, after);
      for (const row of page.rows)
        journalSummarySchema.parse(toJournalSummary(row, me));
      seen.push(...page.rows.map((row) => row.id));
      if (!page.next) return seen;
      after = page.next;
    }
    throw new Error("the walk does not end");
  };
  const expected = [e2, e3].sort().concat([e1, e0]);
  for (const limit of [1, 2, 3, 50])
    assert.deepEqual(await walk(limit), expected, "limit " + limit);
  // Unpublished stays saved, not shown.
  await db.query("UPDATE bikes SET is_public=false WHERE id=$1", [their]);
  assert.deepEqual(await walk(50), []);
  await db.query("UPDATE bikes SET is_public=true WHERE id=$1", [their]);
  assert.equal((await walk(50)).length, 4);
  // Nobody else's saves.
  assert.deepEqual((await savedKeysetPage(db, actor, 50, null)).rows, []);
});

test("saved listings: newest save first, only what is on the market", async () => {
  const live: string[] = [];
  for (let i = 0; i < 3; i++)
    live.push(await addListing(actor, { at: day(1 + i) }));
  const sold = await addListing(actor, { status: "sold" });
  const hidden = await addListing(barred);
  const save = (listing: string, at: string) =>
    db.query(
      "INSERT INTO market_saves(user_id,listing_id,created_at) VALUES($1,$2,$3)",
      [me, listing, at],
    );
  const [l0, l1, l2] = live as [string, string, string];
  await save(l0, day(5));
  await save(l1, day(6));
  await save(l2, day(6));
  await save(sold, day(9));
  await save(hidden, day(9));
  await db.query("UPDATE users SET blocked=true WHERE id=$1", [barred]);
  const legacy = (await savedListings(db, me)).items.map((item) => item.id);
  const walk = async (limit: number) => {
    const seen: string[] = [];
    let after: Cursor = null;
    for (let guard = 0; guard < 20; guard++) {
      const page = await savedApiKeysetPage(db, me, limit, after);
      for (const item of page.items)
        marketListingSchema.parse(toMarketListing(item));
      seen.push(...page.items.map((item) => item.id));
      if (!page.next) return seen;
      after = page.next;
    }
    throw new Error("the walk does not end");
  };
  assert.deepEqual(new Set(legacy), new Set(live));
  for (const limit of [1, 2, 3, 50])
    assert.deepEqual(await walk(limit), legacy, "limit " + limit);
  assert.deepEqual((await savedApiKeysetPage(db, actor, 50, null)).items, []);
});

test("an operation without parameters refuses every parameter", () => {
  assert.deepEqual(
    parseNoQuery(new URL("http://x/api/v1/me/notifications/count")),
    {},
  );
  for (const query of ["?limit=0", "?foo=bar", "?a=1&a=2"])
    assert.throws(() => parseNoQuery(new URL("http://x/m" + query)), {
      code: "invalid_request",
    });
});

const hours = (n: number) => new Date(Date.now() + n * 3600000).toISOString();
interface RideOptions {
  status?: "completed" | "planned" | "cancelled";
  isPublic?: boolean;
  startedAt?: string;
  meeting?: string;
  visibility?: "public" | "participants";
  title?: string;
}
async function addRide(owner: string, bike: string, options: RideOptions = {}) {
  const { status = "completed", isPublic = true } = options;
  const planned = status !== "completed";
  return (
    await rideRow(db, owner, bike, {
      title: options.title,
      status,
      source_kind: planned ? "planned" : "gpx",
      is_public: isPublic,
      started_at: options.startedAt ?? hours(-48),
      distance_m: planned ? 0 : 12000,
      meeting_point: options.meeting,
      meeting_visibility: options.visibility,
    })
  ).id;
}

test("own rides: every state, only mine, the keyset walk is whole", async () => {
  const mine = await addUser("rider");
  const mineBike = await addBike(mine);
  const theirsBike = await addBike(actor);
  const same = hours(-100);
  const expected = [
    await addRide(mine, mineBike, { startedAt: hours(-10) }),
    await addRide(mine, mineBike, { startedAt: hours(-20), isPublic: false }),
    await addRide(mine, mineBike, { startedAt: same }),
    await addRide(mine, mineBike, { startedAt: same }),
    await addRide(mine, mineBike, { status: "planned", startedAt: hours(72) }),
    await addRide(mine, mineBike, {
      status: "planned",
      startedAt: hours(48),
      isPublic: false,
    }),
    await addRide(mine, mineBike, {
      status: "cancelled",
      startedAt: hours(24),
    }),
  ];
  await addRide(actor, theirsBike);
  const walk = async (limit: number) => {
    const seen: string[] = [];
    let after: Cursor = null;
    for (let guard = 0; guard < 20; guard++) {
      const page = await ownRideKeysetPage(db, mine, { limit, after });
      for (const row of page.rows)
        ownRideSummarySchema.parse(toOwnRideSummary(row, mine));
      seen.push(...page.rows.map((row) => row.id));
      if (!page.next) return seen;
      after = page.next;
    }
    throw new Error("the walk does not end");
  };
  const whole = await walk(50);
  assert.deepEqual(new Set(whole), new Set(expected));
  for (const limit of [1, 2, 3])
    assert.deepEqual(await walk(limit), whole, "limit " + limit);
  // Newest first by the start (a plan by its date).
  const cards = (
    await ownRideKeysetPage(db, mine, { limit: 50, after: null })
  ).rows.map((row) => toOwnRideSummary(row, mine));
  const times = cards.map((card) =>
    Date.parse(present(card.startedAt ?? card.scheduledAt)),
  );
  assert.deepEqual(
    times,
    [...times].sort((a, b) => b - a),
  );
  const by = (status: string) => cards.filter((card) => card.status === status);
  assert.equal(by("cancelled").length, 1);
  assert.ok(
    by("cancelled")[0]?.scheduledAt,
    "a called-off plan keeps its date",
  );
  assert.equal(by("planned").length, 2);
  assert.equal(cards.filter((card) => !card.isPublic).length, 2);
  assert.ok(
    cards.every((card) => card.privacyEnabled && card.privacyRadiusM === 500),
  );
  // Nobody else's rides, however public.
  assert.deepEqual(
    (await ownRideKeysetPage(db, actor, { limit: 50, after: null })).rows
      .length,
    1,
  );
});

test("upcoming plans: the role in each, the meeting point by the participants' rule", async () => {
  const organizer = await addUser("organizer");
  const guest = await addUser("guest");
  const outsider = await addUser("outsider");
  const bikeO = await addBike(organizer);
  const bikeG = await addBike(guest);
  const own = await addRide(guest, bikeG, {
    status: "planned",
    startedAt: hours(5),
    meeting: "У фонтана",
  });
  const going = await addRide(organizer, bikeO, {
    status: "planned",
    startedAt: hours(10),
    meeting: "Площадь",
    visibility: "participants",
  });
  const invited = await addRide(organizer, bikeO, {
    status: "planned",
    startedAt: hours(20),
    meeting: "Мост",
    visibility: "participants",
  });
  const maybe = await addRide(organizer, bikeO, {
    status: "planned",
    startedAt: hours(30),
  });
  const stranger = await addRide(organizer, bikeO, {
    status: "planned",
    startedAt: hours(40),
  });
  const closed = await addRide(organizer, bikeO, {
    status: "planned",
    startedAt: hours(50),
    isPublic: false,
  });
  const called = await addRide(organizer, bikeO, {
    status: "cancelled",
    startedAt: hours(60),
  });
  const answer = (
    ride: string,
    who: string,
    response: "accepted" | "maybe",
    at: Date,
  ) => rsvpRow(db, ride, who, at, response);
  const start = async (ride: string) =>
    present(
      (
        await one<{ started_at: Date | null }>(
          db,
          "SELECT started_at FROM rides WHERE id=$1",
          [ride],
        )
      ).started_at,
    );
  await answer(going, guest, "accepted", await start(going));
  await answer(maybe, guest, "maybe", await start(maybe));
  await answer(called, guest, "accepted", await start(called));
  await db.query(
    "INSERT INTO ride_invitations(ride_id,user_id) VALUES($1,$2)",
    [invited, guest],
  );
  await db.query(
    "INSERT INTO ride_invitations(ride_id,user_id) VALUES($1,$2)",
    [closed, outsider],
  );
  const items = async (who: string) =>
    (await myUpcomingEntries(db, who)).map((entry) =>
      toMyUpcomingRide(entry, who),
    );
  const mineItems = await items(guest);
  myUpcomingRidesSchema.parse({ items: mineItems });
  const role = (ride: string) =>
    mineItems.find((item) => item.id === ride)?.role;
  assert.equal(role(own), "organizer");
  assert.equal(role(going), "accepted");
  assert.equal(role(invited), "invited");
  assert.equal(role(maybe), "maybe");
  assert.equal(role(called), "cancelled");
  assert.equal(
    role(stranger),
    undefined,
    "a plan without an answer or an invitation is not mine",
  );
  assert.equal(role(closed), undefined);
  // Soonest first.
  const times = mineItems.map((item) => Date.parse(present(item.scheduledAt)));
  assert.deepEqual(
    times,
    [...times].sort((a, b) => a - b),
  );
  // The meeting point: mine to the organizer, the participants' after "going",
  // hidden from an invitee who has not answered, and none for a called-off plan.
  const point = (ride: string) =>
    present(mineItems.find((item) => item.id === ride));
  assert.equal(point(own).meetingPoint, "У фонтана");
  assert.equal(point(going).meetingPoint, "Площадь");
  assert.equal(point(invited).meetingPoint, null);
  assert.equal(point(invited).meetingHidden, true);
  assert.equal(point(called).meetingPoint, null);
  assert.equal(point(called).status, "cancelled");
  // A called-off date has no counts of its own (they would be another date's).
  assert.equal(point(called).participants, null);
  assert.ok(point(going).participants);
  // An edit of the conditions after the answer is shown.
  await db.query("UPDATE rides SET agreement_revision=2 WHERE id=$1", [going]);
  assert.equal(
    present((await items(guest)).find((item) => item.id === going))
      .changedAfterAnswer,
    true,
  );
  assert.equal(
    present((await items(guest)).find((item) => item.id === maybe))
      .changedAfterAnswer,
    false,
  );
  // Another person has none of these; the invited of a private plan sees it.
  assert.deepEqual(
    (await items(outsider)).map((item) => item.id),
    [closed],
  );
  assert.ok(!JSON.stringify(mineItems).includes("@test.invalid"));
});

test("feed: what the person follows, newest first; a walk by cursor is whole", async () => {
  const reader = await addUser("feed-reader");
  const followed = await addUser("feed-followed");
  const stranger = await addUser("feed-stranger");
  const lonely = await addUser("feed-lonely");
  await db.query(
    "INSERT INTO user_follows(follower_id,following_id) VALUES($1,$2)",
    [reader, followed],
  );
  const bike = await addBike(followed);
  const strangerBike = await addBike(stranger);
  const lonelyBike = await addBike(lonely);
  // One bike followed by itself, not by its owner.
  await db.query("INSERT INTO bike_follows(user_id,bike_id) VALUES($1,$2)", [
    reader,
    lonelyBike,
  ]);
  const ride = await addRide(followed, bike, { startedAt: hours(-30) });
  const linkedRide = await addRide(followed, bike, { startedAt: hours(-31) });
  await addRide(followed, bike, { status: "cancelled", startedAt: hours(10) });
  const entry = await addEntry(followed, bike, { at: day(2) });
  const linkedEntry = await addEntry(followed, bike, { at: day(3) });
  await db.query("UPDATE journal_entries SET ride_id=$1 WHERE id=$2", [
    linkedRide,
    linkedEntry,
  ]);
  const listing = await addListing(followed, { at: day(4) });
  await addListing(followed, { status: "sold" });
  // Nothing of the one who is not followed.
  await addRide(stranger, strangerBike);
  await addEntry(stranger, strangerBike);
  await addListing(stranger);
  const at = new Map([
    [bike, 1],
    [entry, 2],
    [linkedEntry, 3],
    [listing, 4],
    [ride, 4],
    [linkedRide, 5],
    [lonelyBike, 6],
  ]);
  for (const [id, n] of at) {
    for (const table of [
      "bikes",
      "journal_entries",
      "market_listings",
      "rides",
    ])
      await db.query(`UPDATE ${table} SET published_at=$2 WHERE id=$1`, [
        id,
        day(n),
      ]);
  }
  const walk = async (type: FeedType, limit: number) => {
    const seen: FeedCard[] = [];
    let after: Awaited<ReturnType<typeof feedKeysetPage>>["next"] = null;
    for (let guard = 0; guard < 30; guard++) {
      const page = await feedKeysetPage(db, reader, { type, limit, after });
      for (const item of page.items) {
        const card = toFeedItem(item, reader);
        feedItemSchema.parse(card);
        assert.equal(
          [card.bike, card.ride, card.journal, card.listing].filter(Boolean)
            .length,
          1,
        );
        seen.push(card);
      }
      if (!page.next) return seen;
      after = page.next;
    }
    throw new Error("the walk does not end");
  };
  const rank = (id: string) => present(at.get(id));
  const order = (ids: string[]) =>
    [...ids].sort((a, b) => rank(b) - rank(a) || (a < b ? -1 : 1));
  const idOf = (card: FeedCard) =>
    present(card.bike ?? card.ride ?? card.journal ?? card.listing).id;
  const all = await walk("all", 50);
  assert.deepEqual(
    all.map(idOf),
    order([bike, entry, linkedEntry, listing, ride, lonelyBike]),
  );
  assert.ok(
    !all.map(idOf).includes(linkedRide),
    "a ride with its entry is the entry",
  );
  for (const limit of [1, 2, 3])
    assert.deepEqual(
      (await walk("all", limit)).map(idOf),
      all.map(idOf),
      "limit " + limit,
    );
  assert.deepEqual(
    (await walk("rides", 2)).map(idOf),
    order([ride, linkedRide]),
  );
  assert.deepEqual(
    (await walk("journal", 1)).map(idOf),
    order([entry, linkedEntry]),
  );
  assert.deepEqual(
    all.map((card) => card.type),
    order([bike, entry, linkedEntry, listing, ride, lonelyBike]).map(
      (id) =>
        ({
          [bike]: "bike",
          [entry]: "journal",
          [linkedEntry]: "journal",
          [listing]: "market",
          [ride]: "ride",
          [lonelyBike]: "bike",
        })[id],
    ),
  );
  // The instant is the publication, to the millisecond.
  assert.equal(
    present(all.find((card) => idOf(card) === listing)).publishedAt,
    new Date(day(4)).toISOString(),
  );
  // Nobody else's feed; a person who follows nobody has none.
  assert.deepEqual(
    (
      await feedKeysetPage(db, stranger, {
        type: "all",
        limit: 50,
        after: null,
      })
    ).items,
    [],
  );
  // A bike made private takes its rides and entries out; the listing stays.
  await db.query("UPDATE bikes SET is_public=false WHERE id=$1", [bike]);
  assert.deepEqual(
    (await walk("all", 50)).map(idOf),
    order([listing, lonelyBike]),
  );
  await db.query("UPDATE bikes SET is_public=true WHERE id=$1", [bike]);
  // A listing that is sold leaves the feed.
  await db.query("UPDATE market_listings SET status='sold' WHERE id=$1", [
    listing,
  ]);
  assert.ok(!(await walk("all", 50)).map(idOf).includes(listing));
});
