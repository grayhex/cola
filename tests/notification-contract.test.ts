import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { toNotification } from "../lib/api-v1/mappers.ts";
import { notificationSchema } from "../lib/api-v1/schemas.ts";
import {
  notificationCategories,
  notificationCategoryKeys,
  notificationCategoryOf,
  notificationEmailCategorySql,
  notificationEmailEvents,
  notificationEvents,
  notificationTypes,
  notificationTypesOf,
  type NotificationType,
} from "../lib/notification-catalog.ts";
import {
  notificationCard,
  type NotificationRow,
} from "../lib/notifications.ts";
import { testDatabase } from "./support/database.ts";

// The contract of a notification (#341): the catalogue of events and
// categories, and the typed target an app routes by. The matrix in
// docs/modules/notifications.md and the published fixtures are checked against
// the same catalogue in notification-docs.test.ts.

const db = await testDatabase();
after(() => db.close());

test("the catalogue knows exactly the types the table accepts", async () => {
  const { rows } = await db.query<{ def: string }>(
    "SELECT pg_get_constraintdef(oid) def FROM pg_constraint WHERE conrelid='notifications'::regclass AND contype='c' AND pg_get_constraintdef(oid) NOT LIKE '%reasons%'",
  );
  // Every quoted word of those constraints is an event type (the constraints on
  // `reasons` name reasons, not types).
  const accepted = new Set(
    rows.flatMap(({ def }) =>
      [...def.matchAll(/'([a-z_]+)'::text/g)].map((match) => match[1]),
    ),
  );
  assert.deepEqual([...accepted].sort(), [...notificationTypes].sort());
});

test("categories: every event has one and the lists agree", () => {
  for (const type of notificationTypes)
    assert.ok(
      Object.hasOwn(notificationCategories, notificationEvents[type].category),
      type,
    );
  assert.deepEqual(
    notificationCategoryKeys
      .flatMap((category) => notificationTypesOf(category))
      .sort(),
    [...notificationTypes].sort(),
    "each type belongs to exactly one category",
  );
  assert.equal(notificationCategoryOf("not_a_type"), "site");
  // A category without a channel is only a filter of the inbox.
  for (const key of notificationCategoryKeys) {
    const category = notificationCategories[key];
    if (!category.email && !category.push)
      assert.deepEqual(
        notificationTypesOf(key).filter((type) =>
          Object.hasOwn(notificationEmailEvents, type),
        ),
        [],
        key,
      );
    if (!category.push) assert.equal(category.pushDefault, false, key);
  }
});

test("e-mail events: the same thirteen, in the categories the outbox knows, with a subject and one line", () => {
  assert.deepEqual(Object.keys(notificationEmailEvents).sort(), [
    "comment",
    "component_reply",
    "journal_comment",
    "journal_reply",
    "market_expiring",
    "reply",
    "ride_cancelled",
    "ride_changed",
    "ride_comment",
    "ride_invite",
    "ride_reminder",
    "ride_reply",
    "ride_response",
  ]);
  for (const [type, event] of Object.entries(notificationEmailEvents)) {
    assert.ok(
      ["discussions", "rides", "market"].includes(event.category),
      type,
    );
    assert.ok(event.subject.length > 5 && event.line.length > 20, type);
    // A mail names the kind of event, never a place or a comment.
    assert.doesNotMatch(event.line, /[«»"<>]/, type);
  }
  const sql = notificationEmailCategorySql("n.type");
  for (const type of Object.keys(notificationEmailEvents))
    assert.ok(sql.includes(`'${type}'`), type);
  assert.ok(!sql.includes("'follow'") && !sql.includes("'like'"));
  // The categories of the e-mail table are the catalogue's e-mailable ones.
  assert.deepEqual(
    notificationCategoryKeys
      .filter((key) => notificationCategories[key].email)
      .sort(),
    ["discussions", "market", "rides"],
  );
});

// ---- The typed target ------------------------------------------------------
const noRow: NotificationRow = {
  id: "",
  type: "",
  created_at: new Date("2026-09-01T10:00:00.000Z"),
  read_at: null,
  comment_id: "",
  ride_comment_id: "",
  entry_comment_id: "",
  component_comment_id: "",
  component_id: "",
  component_name: "",
  category_slug: "",
  slug: "",
  listing_id: "",
  listing_share: "",
  listing_title: "",
  listing_status: "",
  listing_expires: new Date("2026-10-01T00:00:00.000Z"),
  listing_expired: false,
  listing_due: false,
  entry_id: "",
  entry_kind: "",
  entry_share: "",
  entry_title: "",
  ride_id: "",
  ride_share_id: "",
  ride_title: "",
  intent_id: "",
  bike_id: "",
  share_id: "",
  bike_name: "",
  actor_id: "",
  username: "",
  name: "",
  avatar_id: "",
  event_occurs_at: null,
  event_revision: null,
  reasons: null,
};
const comment = randomUUID();
const person = {
  actor_id: randomUUID(),
  username: "anna",
  name: "Анна",
  avatar_id: "",
};
const bike = { bike_id: randomUUID(), share_id: "bk1", bike_name: "Gravel" };
const ride = {
  ride_id: randomUUID(),
  ride_share_id: "rd1",
  ride_title: "Субботний круг",
};
const entry = {
  entry_id: randomUUID(),
  entry_kind: "build",
  entry_share: "en1",
  entry_title: "Новая цепь",
};
const occurrence = new Date("2026-10-10T07:00:00.000Z");
const dated = { event_occurs_at: occurrence, event_revision: 3 };

interface Expected {
  row: Partial<NotificationRow>;
  target: string;
  comment?: string;
  dated?: boolean;
}
const cases: Record<NotificationType, Expected> = {
  follow: { row: person, target: "profile" },
  like: { row: { ...person, ...bike }, target: "bike" },
  comment: {
    row: { ...person, ...bike, comment_id: comment },
    target: "bike",
    comment,
  },
  reply: {
    row: { ...person, ...bike, comment_id: comment },
    target: "bike",
    comment,
  },
  ride_like: { row: { ...person, ...ride }, target: "ride" },
  ride_comment: {
    row: { ...person, ...ride, ride_comment_id: comment },
    target: "ride",
    comment,
  },
  ride_reply: {
    row: { ...person, ...ride, ride_comment_id: comment },
    target: "ride",
    comment,
  },
  journal_like: { row: { ...person, ...entry }, target: "journal" },
  journal_comment: {
    row: { ...person, ...entry, entry_comment_id: comment },
    target: "journal",
    comment,
  },
  journal_reply: {
    row: { ...person, ...entry, entry_comment_id: comment },
    target: "journal",
    comment,
  },
  component_reply: {
    row: {
      ...person,
      component_id: randomUUID(),
      component_name: "Cassette",
      category_slug: "drivetrain",
      slug: "cs-hg700",
      component_comment_id: comment,
    },
    target: "component",
    comment,
  },
  ride_invite: {
    row: { ...person, ...ride, ...dated },
    target: "ride",
    dated: true,
  },
  ride_changed: {
    row: { ...person, ...ride, ...dated },
    target: "ride",
    dated: true,
  },
  ride_cancelled: {
    row: { ...person, ...ride, ...dated },
    target: "ride",
    dated: true,
  },
  ride_response: {
    row: { ...ride, ...dated, actor_id: "" },
    target: "ride",
    dated: true,
  },
  ride_reminder: {
    row: { ...ride, ...dated, actor_id: "" },
    target: "ride",
    dated: true,
  },
  market_expiring: {
    row: {
      listing_id: randomUUID(),
      listing_share: "ml1",
      listing_title: "Рама",
      listing_status: "active",
      listing_due: true,
    },
    target: "market",
  },
  plan_published: {
    row: { ...person, ...ride, ...dated },
    target: "ride",
    dated: true,
  },
  intent_published: {
    row: { ...person, intent_id: randomUUID() },
    target: "intent",
  },
  plan_nearby: {
    row: { ...person, ...ride, ...dated },
    target: "ride",
    dated: true,
  },
  session_reuse: { row: {}, target: "account" },
  bike_week: { row: bike, target: "bike-week" },
};

test("a card names its category and, in typed fields, the comment, the date and the version of the agreements", () => {
  assert.deepEqual(Object.keys(cases).sort(), [...notificationTypes].sort());
  for (const type of notificationTypes) {
    const expected = cases[type];
    const card = notificationCard({
      ...noRow,
      id: randomUUID(),
      type,
      ...expected.row,
    });
    assert.equal(card.category, notificationEvents[type].category, type);
    assert.equal(card.target.type, expected.target, type);
    assert.equal(card.target.commentId, expected.comment ?? null, type);
    assert.equal(
      card.target.occurrenceAt?.toISOString() ?? null,
      expected.dated ? occurrence.toISOString() : null,
      type,
    );
    assert.equal(
      card.target.agreementRevision,
      expected.dated ? 3 : null,
      type,
    );
    // What the API sends: the strict contract accepts it as it is.
    const shown = notificationSchema.parse(toNotification(card));
    assert.equal(shown.category, card.category);
    assert.equal(shown.target.commentId, card.target.commentId);
    assert.equal(
      shown.target.occurrenceAt,
      expected.dated ? occurrence.toISOString() : null,
    );
    // A comment is also in the address, so a person without the app lands on it.
    if (expected.comment)
      assert.match(shown.target.path, new RegExp("comment=" + comment), type);
  }
});

test("an article is a journal entry with its own words, in the same category", () => {
  const card = notificationCard({
    ...noRow,
    id: randomUUID(),
    type: "journal_comment",
    ...person,
    ...entry,
    entry_kind: "article",
    entry_comment_id: comment,
  });
  assert.equal(card.type, "article_comment");
  assert.equal(card.category, "discussions");
  assert.equal(card.target.type, "article");
  assert.equal(card.target.commentId, comment);
});

test("a historical invitation has no date: the typed fields are null and the address stays", () => {
  const card = notificationCard({
    ...noRow,
    id: randomUUID(),
    type: "ride_invite",
    ...person,
    ...ride,
  });
  const shown = notificationSchema.parse(toNotification(card));
  assert.equal(shown.target.occurrenceAt, null);
  assert.equal(shown.target.agreementRevision, null);
  assert.equal(shown.target.commentId, null);
  assert.equal(shown.target.path, "/r/rd1");
});
