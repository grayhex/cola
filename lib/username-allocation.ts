import { randomInt } from "node:crypto";
import type { Queryable } from "./db.ts";
import { usernameCandidates } from "./usernames.ts";

// Server-side allocation stays separate from the browser's pure suggestions.
// The unique index still decides races; callers retry on a username conflict.
export async function allocateUsername(q: Queryable, base: string) {
  const candidates = usernameCandidates(base);
  const { rows } = await q.query<{ username: string }>(
    "SELECT lower(username) AS username FROM users WHERE lower(username)=ANY($1::text[])",
    [candidates],
  );
  const taken = new Set(rows.map((r) => r.username));
  const free = candidates.find((c) => !taken.has(c));
  if (free) return free;
  const stem = base.slice(0, 23).replace(/^[-._]+|[-._]+$/g, "") || "rider";
  return stem + "-" + String(randomInt(1_000_000)).padStart(6, "0");
}
