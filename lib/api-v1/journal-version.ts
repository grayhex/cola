import type { Queryable } from "../db.ts";
import { etagOf } from "./request.ts";

// The version of a journal entry for `If-Match` (#347): the read and the write
// handlers share it, and it lives apart so that neither imports the other.

/** The version of an entry: the text of `updated_at`, to the microsecond. */
export const etagOfEntry = (id: string, version: string) =>
  etagOf("journal", id, version);

/** The version of the owner's entry, or undefined for any other reader. */
export async function ownEntryVersion(q: Queryable, id: string, owner: string) {
  const { rows } = await q.query<{ version: string }>(
    "SELECT updated_at::text AS version FROM journal_entries WHERE id=$1 AND owner_id=$2",
    [id, owner],
  );
  return rows[0]?.version;
}
