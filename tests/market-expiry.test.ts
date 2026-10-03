// #116: listing terms, the owner's notice and extension, the seller's other
// listings and saved listings. Time is substituted with mock timers: PGlite's
// now() follows the mocked Date, so SQL and JS move together.
import test from "node:test";
import assert from "node:assert/strict";
import type { z } from "zod";
import type { Queryable } from "../lib/db.ts";
import { defaultSettings } from "../lib/site-defaults.ts";
import {
  saveListing,
  marketList,
  marketDetail,
  marketContact,
  extendListing,
  noticeExpiringListings,
  sellerListings,
  setListingSaved,
  savedListings,
} from "../lib/market.ts";
import { notificationPage, unreadCount } from "../lib/notifications.ts";
import { communityActivity } from "../lib/discovery.ts";
import { sitemapEntries } from "../lib/indexing.ts";
import { loadSocialPreview } from "../lib/social-preview.ts";
import { socialMetadata } from "../lib/social-metadata.ts";
import type { listingInput } from "../lib/market.ts";
import {
  seedSiteDefaults,
  testDatabase,
  type TestDatabase,
} from "./support/database.ts";
import { listingDraft } from "./support/market.ts";
import { present } from "./support/assertions.ts";
import { processEnv } from "./support/env.ts";
import { userRow } from "./support/people.ts";

const day = 86400000;
const start = new Date("2026-10-01T09:00:00Z").getTime();
const env = processEnv({ APP_ORIGIN: "https://colabike.example" });

async function schema() {
  const db = await testDatabase();
  await seedSiteDefaults(db);
  return db;
}
async function user(db: Queryable, username: string) {
  return (await userRow(db, { name: username, username })).id;
}
type Offer = Partial<z.input<typeof listingInput>>;
const publish = (db: TestDatabase, owner: string, extra: Offer, id?: string) =>
  db.transaction((q) => saveListing(q, owner, listingDraft(extra), id));
const listed = async (
  db: Queryable,
  viewer: string | null,
  options?: Parameters<typeof marketList>[2],
) => (await marketList(db, viewer, options)).items.map((m) => m.title);
// Only the expiry notices carry a state; the type of the target says so.
const stateOf = (notice: { target: object }): unknown =>
  "state" in notice.target ? notice.target.state : undefined;
const endOf = (listing: { expiresAt?: Date | null }) => {
  assert.ok(listing.expiresAt, "the owner sees the end of the term");
  return new Date(listing.expiresAt).getTime();
};
const notices = async (db: Queryable, owner: string) =>
  (await notificationPage(db, owner)).notifications.filter(
    (n) => n.type === "market_expiring",
  );

test("a listing expires after its term, the owner hears three days ahead and extends it in one step", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: start });
  const db = await schema();
  try {
    const seller = await user(db, "term_seller"),
      buyer = await user(db, "term_buyer");
    const listing = await publish(db, seller, { title: "Gravel wheels" });
    const detail = () => marketDetail(db, listing.shareId, null);
    const own = await marketDetail(db, listing.shareId, seller);
    // The default term is 60 days; only the owner sees the date.
    assert.equal(endOf(own) - start, defaultSettings.marketListingDays * day);
    assert.equal("expiresAt" in (await detail()), false);
    assert.equal((await detail()).expired, false);

    // Four days before the end: no notice yet.
    t.mock.timers.setTime(start + 56 * day);
    await noticeExpiringListings(db, seller);
    assert.deepEqual(await notices(db, seller), []);
    // Two days before: one notice, however often the owner looks.
    t.mock.timers.setTime(start + 58 * day);
    await noticeExpiringListings(db, seller);
    await noticeExpiringListings(db, seller);
    const [first, ...more] = await notices(db, seller);
    let notice = present(first);
    assert.equal(more.length, 0);
    assert.equal(notice.actor, null);
    assert.equal(stateOf(notice), "expiring");
    assert.equal(notice.target.id, own.id);
    assert.equal((await unreadCount(db, seller)).unread, 1);
    // Nobody else gets it.
    await noticeExpiringListings(db, buyer);
    assert.deepEqual(await notices(db, buyer), []);

    // The term is over: it behaves like a sold listing.
    t.mock.timers.setTime(start + 61 * day);
    assert.deepEqual(await listed(db, buyer), []);
    assert.deepEqual(
      (await communityActivity(db)).events.filter((i) => i.type === "market"),
      [],
    );
    const sitemap = async () =>
      (await sitemapEntries(db, env)).filter((e) => e.url.includes("/market/"));
    assert.deepEqual(await sitemap(), []);
    // The direct link opens it with a mark, no contact and noindex.
    assert.equal((await detail()).expired, true);
    await assert.rejects(marketContact(db, listing.shareId, buyer), {
      status: 404,
    });
    assert.equal(
      await marketContact(db, listing.shareId, seller),
      "+7 900 000-00-00",
    );
    const preview = await loadSocialPreview(db, "market", listing.shareId);
    assert.ok(preview);
    assert.equal(preview.closed, true);
    assert.deepEqual(socialMetadata(preview, env).robots, {
      index: false,
      follow: false,
    });
    // The owner still has it, marked, and the notice says it is over.
    const mine = (await marketList(db, seller, { own: true })).items;
    assert.equal(mine.length, 1);
    assert.equal(mine[0].expired, true);
    [notice] = await notices(db, seller);
    assert.equal(stateOf(notice), "expired");
    // Nobody but the owner extends it.
    await assert.rejects(
      db.transaction((q) => extendListing(q, own.id, buyer)),
      { status: 409 },
    );

    // One step: a new full term from now, and it is back everywhere.
    const extended = await db.transaction((q) =>
      extendListing(q, own.id, seller),
    );
    assert.equal(endOf(extended), start + 61 * day + 60 * day);
    assert.deepEqual(await listed(db, buyer), ["Gravel wheels"]);
    assert.equal((await detail()).expired, false);
    assert.equal(
      (await loadSocialPreview(db, "market", listing.shareId))?.closed,
      false,
    );
    assert.equal((await sitemap()).length, 1);
    assert.equal(
      (await communityActivity(db)).events.filter((i) => i.type === "market")
        .length,
      1,
    );
    [notice] = await notices(db, seller);
    assert.equal(stateOf(notice), "extended");
    // The new term earns its own notice when it ends.
    t.mock.timers.setTime(start + 61 * day + 58 * day);
    await noticeExpiringListings(db, seller);
    assert.equal((await notices(db, seller)).length, 2);

    // A sold listing is closed, not expiring, and cannot be extended.
    await publish(
      db,
      seller,
      { title: "Gravel wheels", status: "sold" },
      own.id,
    );
    assert.equal(stateOf((await notices(db, seller))[0]!), "closed");
    await assert.rejects(
      db.transaction((q) => extendListing(q, own.id, seller)),
      { status: 409 },
    );
  } finally {
    await db.close();
  }
});

test("editing keeps the term, publishing again starts a new one, the admin sets its length", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: start });
  const db = await schema();
  try {
    const seller = await user(db, "edit_seller");
    const listing = await publish(db, seller, { title: "Saddle" });
    const term = async () =>
      endOf(await marketDetail(db, listing.shareId, seller));
    t.mock.timers.setTime(start + 10 * day);
    await publish(db, seller, { title: "Saddle, new photos" }, listing.id);
    assert.equal(await term(), start + 60 * day);
    // Published again after the end of the term: a new term.
    t.mock.timers.setTime(start + 70 * day);
    await publish(db, seller, { title: "Saddle" }, listing.id);
    assert.equal(await term(), start + 130 * day);
    // From a draft: a new term too.
    await publish(db, seller, { title: "Saddle", status: "draft" }, listing.id);
    t.mock.timers.setTime(start + 80 * day);
    await publish(db, seller, { title: "Saddle" }, listing.id);
    assert.equal(await term(), start + 140 * day);
    // The administrator's term applies to new publications and extensions;
    // an extension never shortens a longer term.
    await db.query(
      "UPDATE site_settings SET value=value||'{\"marketListingDays\":14}' WHERE id=1",
    );
    const short = await publish(db, seller, { title: "Pedals" });
    assert.equal(
      endOf(await marketDetail(db, short.shareId, seller)),
      start + 94 * day,
    );
    await db.transaction((q) => extendListing(q, listing.id, seller));
    assert.equal(await term(), start + 140 * day);
    t.mock.timers.setTime(start + 139 * day);
    await db.transaction((q) => extendListing(q, listing.id, seller));
    assert.equal(await term(), start + 153 * day);
  } finally {
    await db.close();
  }
});

test("other listings of the seller: on the market only, never drafts, sold, expired or someone else's", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: start });
  const db = await schema();
  try {
    const seller = await user(db, "shelf_seller"),
      other = await user(db, "shelf_other"),
      viewer = await user(db, "shelf_viewer");
    const current = await publish(db, seller, { title: "Current" });
    for (const [i, title] of [
      "One",
      "Two",
      "Three",
      "Four",
      "Five",
    ].entries()) {
      t.mock.timers.setTime(start + (i + 1) * 1000);
      await publish(db, seller, { title });
    }
    await publish(db, seller, { title: "Draft", status: "draft" });
    await publish(db, seller, { title: "Sold", status: "sold" });
    t.mock.timers.setTime(start - 70 * day);
    await publish(db, seller, { title: "Expired" });
    t.mock.timers.setTime(start + 10000);
    await publish(db, other, { title: "Someone else's" });
    const shelf = await sellerListings(db, current.id, viewer);
    assert.deepEqual(
      shelf.items.map((m) => m.title),
      ["Five", "Four", "Three", "Two"],
    );
    assert.equal(shelf.total, 5);
    // The owner looking at their own listing sees the same shelf.
    assert.deepEqual(
      (await sellerListings(db, current.id, seller)).items.map((m) => m.title),
      ["Five", "Four", "Three", "Two"],
    );
    // "All listings of the seller" is the seller filter of /market.
    assert.deepEqual(
      (await listed(db, viewer, { seller: "shelf_seller" })).sort(),
      ["Current", "Five", "Four", "One", "Three", "Two"],
    );
    // A blocked seller's listings are gone.
    await db.query("UPDATE users SET blocked=true WHERE id=$1", [seller]);
    assert.deepEqual((await sellerListings(db, current.id, viewer)).items, []);
    assert.deepEqual(await listed(db, viewer, { seller: "shelf_seller" }), []);
  } finally {
    await db.close();
  }
});

test("saved listings show only what is on the market: not sold, expired or hidden", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: start });
  const db = await schema();
  try {
    const seller = await user(db, "saves_seller"),
      buyer = await user(db, "saves_buyer");
    // One after another, as a person would publish them.
    const ids = {
      Sold: await publish(db, seller, { title: "Sold" }),
      Hidden: await publish(db, seller, { title: "Hidden" }),
      Expiring: await publish(db, seller, { title: "Expiring" }),
      Kept: await publish(db, seller, { title: "Kept" }),
    };
    for (const { id } of Object.values(ids))
      assert.deepEqual(
        await db.transaction((q) => setListingSaved(q, id, buyer, true)),
        { saved: true },
      );
    const saved = async () =>
      (await savedListings(db, buyer)).items.map((m) => m.title).sort();
    assert.deepEqual(await saved(), ["Expiring", "Hidden", "Kept", "Sold"]);
    assert.equal((await marketDetail(db, ids.Kept.shareId, buyer)).saved, true);
    assert.equal(
      (await marketDetail(db, ids.Kept.shareId, seller)).saved,
      false,
    );

    await publish(db, seller, { title: "Sold", status: "sold" }, ids.Sold.id);
    await publish(
      db,
      seller,
      { title: "Hidden", status: "draft" },
      ids.Hidden.id,
    );
    await db.query("UPDATE market_listings SET expires_at=$2 WHERE id=$1", [
      ids.Expiring.id,
      new Date(start + 5 * day),
    ]);
    t.mock.timers.setTime(start + 6 * day);
    assert.deepEqual(await saved(), ["Kept"]);
    // They stay saved: a listing back on the market comes back to the list.
    await publish(db, seller, { title: "Hidden" }, ids.Hidden.id);
    assert.deepEqual(await saved(), ["Hidden", "Kept"]);
    // Only a listing on the market can be saved; removing always works.
    await db.transaction((q) => setListingSaved(q, ids.Sold.id, buyer, false));
    await assert.rejects(
      db.transaction((q) => setListingSaved(q, ids.Sold.id, buyer, true)),
      { status: 404 },
    );
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM market_saves")).rows[0].n,
      3,
    );
    // A blocked seller's listings leave the list as well.
    await db.query("UPDATE users SET blocked=true WHERE id=$1", [seller]);
    assert.deepEqual(await saved(), []);
  } finally {
    await db.close();
  }
});
