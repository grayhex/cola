import { randomUUID } from "node:crypto";
import type { Queryable } from "../../lib/db.ts";
import type {
  BikeCommentRow,
  JournalRow,
  NotificationRecord,
} from "../../lib/database-rows.ts";
import { given, insertRow, type Columns } from "./rows.ts";

/**
 * A stored notice for `recipientId` (not yet read). It is its own dedup key,
 * so builders never collide. `overrides` are columns of `notifications`; the
 * table's CHECK says which target a type needs (`bike_id` and `comment_id`
 * for a comment, and so on).
 */
export function noticeRow(
  q: Queryable,
  recipientId: string,
  type: string,
  overrides: Columns<NotificationRecord> = {},
): Promise<NotificationRecord> {
  const id = overrides.id ?? randomUUID();
  return insertRow<NotificationRecord>(q, "notifications", {
    id,
    recipient_id: recipientId,
    type,
    dedup_key: id,
    ...given(overrides),
  });
}

/** A comment on a bike. */
export function bikeCommentRow(
  q: Queryable,
  bikeId: string,
  authorId: string,
  overrides: Columns<BikeCommentRow> = {},
): Promise<BikeCommentRow> {
  return insertRow<BikeCommentRow>(q, "bike_comments", {
    id: randomUUID(),
    bike_id: bikeId,
    author_id: authorId,
    body: "Привет",
    ...given(overrides),
  });
}

/** A published, public entry of a bike's journal. */
export function journalEntryRow(
  q: Queryable,
  ownerId: string,
  bikeId: string,
  overrides: Columns<JournalRow> = {},
): Promise<JournalRow> {
  const id = overrides.id ?? randomUUID();
  return insertRow<JournalRow>(
    q,
    "journal_entries",
    {
      id,
      share_id: randomUUID(),
      owner_id: ownerId,
      bike_id: bikeId,
      kind: "build",
      title: "Запись",
      body: "Текст записи",
      status: "published",
      is_public: true,
      event_date: "2026-08-30",
      mileage: 100,
      components: [],
      ...given(overrides),
    },
    ["components"],
  );
}
