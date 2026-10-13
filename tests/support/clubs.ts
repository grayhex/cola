import { randomUUID } from "node:crypto";
import type { Queryable } from "../../lib/db.ts";
import { createClub, clubCreateInput } from "../../lib/clubs.ts";
import { createClubPost, clubPostCreateInput } from "../../lib/club-posts.ts";
export function clubRow(
  q: Queryable,
  owner: string,
  overrides: Partial<Parameters<typeof createClub>[2]> = {},
) {
  return createClub(
    q,
    owner,
    clubCreateInput.parse({
      name: "Клуб " + randomUUID().slice(0, 8),
      requestId: randomUUID(),
      joinMode: "open",
      ...overrides,
    }),
  );
}
export function clubPostRow(
  q: Queryable,
  club: string,
  owner: string,
  overrides: Partial<Parameters<typeof createClubPost>[3]> = {},
) {
  return createClubPost(
    q,
    club,
    owner,
    clubPostCreateInput.parse({
      requestId: randomUUID(),
      title: "История клуба",
      body: "Текст публикации",
      status: "published",
      ...overrides,
    }),
  );
}
