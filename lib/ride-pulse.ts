import type { Queryable } from "./db.ts";
import { activeCommunityIntent } from "./ride-intents.ts";
import { publicAuthor } from "./profile-dto.ts";

export const pulseTimeZone = "Europe/Moscow";
// One upcoming window per person, not per intention. Ongoing windows count
// while they still have future time, exactly as on /ride-intents.
const nextPeople = `SELECT DISTINCT ON (i.owner_id) i.owner_id,i.readiness,
  greatest(w.starts_at,$1::timestamptz) starts_at,w.ends_at,
  u.name,u.username,u.avatar_id
  FROM ride_intents i JOIN users u ON u.id=i.owner_id
  JOIN ride_intent_windows w ON w.intent_id=i.id AND w.ends_at>$1::timestamptz
  WHERE ${activeCommunityIntent("$1::timestamptz")}
  ORDER BY i.owner_id,greatest(w.starts_at,$1::timestamptz),w.ends_at,i.id`;

export async function ridePulse(q: Queryable, now = new Date()) {
  const { rows } = await q.query<{
    total: number;
    ready: number;
    considering: number;
    today: number;
    tomorrow: number;
    weekend: number;
    later: number;
  }>(
    `WITH people AS (${nextPeople}), dates AS (
    SELECT *, (starts_at AT TIME ZONE '${pulseTimeZone}')::date local_day,
      ($1::timestamptz AT TIME ZONE '${pulseTimeZone}')::date today FROM people
  ), buckets AS (
    SELECT *, CASE WHEN local_day=today THEN 'today' WHEN local_day=today+1 THEN 'tomorrow'
      WHEN extract(isodow FROM local_day) IN (6,7) AND local_day<date_trunc('week',today)::date+7 THEN 'weekend'
      ELSE 'later' END bucket FROM dates
  ) SELECT count(*)::int total,
    count(*) FILTER(WHERE readiness='ready')::int ready,
    count(*) FILTER(WHERE readiness='considering')::int considering,
    count(*) FILTER(WHERE bucket='today')::int today,
    count(*) FILTER(WHERE bucket='tomorrow')::int tomorrow,
    count(*) FILTER(WHERE bucket='weekend')::int weekend,
    count(*) FILTER(WHERE bucket='later')::int later FROM buckets`,
    [now],
  );
  const row = rows[0]!;
  return {
    total: row.total,
    ready: row.ready,
    considering: row.considering,
    buckets: (
      [
        ["today", "Сегодня"],
        ["tomorrow", "Завтра"],
        ["weekend", "В выходные"],
        ["later", "Позже"],
      ] as const
    ).map(([key, label]) => ({ key, label, count: row[key] })),
    timeZone: pulseTimeZone,
    asOf: now.toISOString(),
  };
}

// This DTO is never part of the public home snapshot. Check the viewer here,
// too, so direct callers cannot accidentally disclose community identities.
export async function ridePulsePeople(
  q: Queryable,
  viewerId: string,
  now = new Date(),
) {
  const { rows } = await q.query<{
    owner_id: string;
    name: string;
    username: string;
    avatar_id: string | null;
    readiness: "ready" | "considering";
    starts_at: Date;
    ends_at: Date;
  }>(
    `WITH people AS (${nextPeople}) SELECT * FROM people
    WHERE EXISTS(SELECT 1 FROM users WHERE id=$2 AND NOT blocked)
    ORDER BY starts_at,owner_id LIMIT 4`,
    [now, viewerId],
  );
  return {
    people: rows.map((row) => ({
      author: publicAuthor({
        id: row.owner_id,
        name: row.name,
        username: row.username,
        avatar_id: row.avatar_id,
      }),
      readiness: row.readiness,
      startsAt: row.starts_at.toISOString(),
      endsAt: row.ends_at.toISOString(),
    })),
    timeZone: pulseTimeZone,
  };
}
