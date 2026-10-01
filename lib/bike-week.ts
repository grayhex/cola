import { randomUUID } from "node:crypto";
import type { Queryable } from "./db.ts";
import type { z } from "zod";
import {
  bikeWeekSettingsInput,
  bikeWeekStart,
} from "./bike-week-validation.ts";
import type {
  BikeWeekSettings,
  bikeWeekStoryInput,
  bikeWeekDecisionInput,
} from "./bike-week-validation.ts";
import { CommunityError } from "./community-validation.ts";
import { publicAuthor } from "./profile-dto.ts";
import { plainExcerpt } from "./excerpt.ts";
import { audit } from "./site.ts";

export async function getBikeWeekSettings(
  q: Queryable,
): Promise<BikeWeekSettings> {
  return bikeWeekSettingsInput.parse(
    (
      await q.query<{ value: unknown }>(
        "SELECT value FROM bike_week_settings WHERE id=1",
      )
    ).rows[0]?.value || {},
  );
}
export async function saveBikeWeekSettings(
  q: Queryable,
  actor: string,
  value: BikeWeekSettings,
) {
  await q.query("UPDATE bike_week_settings SET value=$1 WHERE id=1", [value]);
  await audit(q, actor, "bike-week.settings", JSON.stringify(value));
  return value;
}
const eligible = `b.is_public AND NOT u.blocked AND NOT b.leaderboard_excluded
  AND EXISTS(SELECT 1 FROM photos WHERE bike_id=b.id)
  AND (SELECT count(DISTINCT component_key(category)) FROM components WHERE bike_id=b.id AND section='build' AND trim(name)<>'' AND trim(category)<>'')>=5`;
interface Candidate {
  id: string;
  owner_id: string;
  share_id: string;
  name: string;
  likes: number;
  reactions: number;
  participants: number;
  score: number;
}
interface WeekRow {
  week: string;
  bike_id: string | null;
  owner_id: string | null;
  status: "selected" | "empty" | "skipped" | "invalid";
  source: "automatic" | "override" | "skip";
  metrics: Record<string, number>;
  story: string;
  story_published_at: Date | null;
  selected_at: Date | null;
  window_start: Date;
  window_end: Date;
}
export interface BikeWeekChoice {
  id: string;
  share_id: string;
  name: string;
  owner_name: string;
  username: string;
  photo_id: string | null;
}
const choiceFields = `b.id,b.share_id,b.name,u.name owner_name,u.username,
  (SELECT id FROM photos WHERE bike_id=b.id ORDER BY is_cover DESC,created_at,id LIMIT 1) photo_id`;
// Read-only picker for an administrator. The existing decision path still
// validates eligibility under locks when the chosen bike is assigned.
export async function searchBikeWeekChoices(
  q: Queryable,
  week: string,
  search = "",
) {
  return (
    await q.query<BikeWeekChoice>(
      `SELECT ${choiceFields} FROM bikes b JOIN users u ON u.id=b.owner_id
     WHERE ${eligible}
       AND NOT EXISTS(SELECT 1 FROM bike_week_declines d WHERE d.week_start=$1::date AND d.bike_id=b.id)
       AND ($2='' OR position(lower($2) in lower(concat_ws(' ',b.name,b.brand,b.model,u.name,u.username,b.id::text)))>0)
     ORDER BY b.name,b.id LIMIT 20`,
      [week, search.replace(/^@/, "")],
    )
  ).rows;
}
const windowFor = (week: string, days: number) => {
  const end = new Date(week + "T00:00:00+03:00");
  return { start: new Date(end.getTime() - days * 86400000), end };
};
// One aggregate per signal. A rider contributes once per type even when they
// react in three ways or post many replies. Windows are half-open and fixed
// at Monday midnight, never shifted by a late worker or an admin preview.
export const bikeWeekCandidatesSQL = `WITH signals AS (
  SELECT l.bike_id,l.user_id,'likes' kind FROM bike_likes l WHERE l.created_at >= $1 AND l.created_at < $2
  UNION ALL SELECT r.bike_id,r.user_id,'reactions' FROM bike_reactions r WHERE r.created_at >= $1 AND r.created_at < $2
  UNION ALL SELECT c.bike_id,c.author_id,'participants' FROM bike_comments c WHERE c.created_at >= $1 AND c.created_at < $2 AND c.deleted_at IS NULL
), counts AS (
  SELECT s.bike_id,count(DISTINCT s.user_id) FILTER(WHERE kind='likes')::int likes,
    count(DISTINCT s.user_id) FILTER(WHERE kind='reactions')::int reactions,
    count(DISTINCT s.user_id) FILTER(WHERE kind='participants')::int participants
  FROM signals s JOIN users a ON a.id=s.user_id AND NOT a.blocked JOIN bikes b ON b.id=s.bike_id AND b.owner_id<>s.user_id GROUP BY s.bike_id
), candidates AS (
  SELECT b.id,b.owner_id,b.share_id,b.name,coalesce(c.likes,0) likes,coalesce(c.reactions,0) reactions,coalesce(c.participants,0) participants
  FROM bikes b JOIN users u ON u.id=b.owner_id LEFT JOIN counts c ON c.bike_id=b.id
  WHERE ${eligible}
    AND NOT EXISTS(SELECT 1 FROM bike_week_declines d WHERE d.week_start=$3::date AND d.bike_id=b.id)
    AND ($4::uuid IS NOT NULL OR NOT EXISTS(SELECT 1 FROM bike_week_history h WHERE h.bike_id=b.id AND h.event='selected' AND h.week_start >= $3::date - $5::int*7 AND h.week_start < $3::date))
    AND ($4::uuid IS NULL OR b.id=$4)
), scored AS (
  SELECT *, (likes*$6::float8 + reactions*$7::float8 + participants*$8::float8) score FROM candidates
) SELECT * FROM scored WHERE $4::uuid IS NOT NULL OR (likes >= $9 AND reactions >= $10 AND participants >= $11 AND score >= $12)
 ORDER BY score DESC,id LIMIT $13`;
async function candidates(
  q: Queryable,
  week: string,
  settings: BikeWeekSettings,
  bikeId: string | null = null,
  limit = 20,
) {
  const { start, end } = windowFor(week, settings.windowDays);
  return (
    await q.query<Candidate>(bikeWeekCandidatesSQL, [
      start,
      end,
      week,
      bikeId,
      settings.cooldownWeeks,
      settings.likeWeight,
      settings.reactionWeight,
      settings.discussionWeight,
      settings.minimumLikes,
      settings.minimumReactions,
      settings.minimumParticipants,
      settings.minimumScore,
      limit,
    ])
  ).rows;
}
const weekRow = async (q: Queryable, week: string) =>
  (
    await q.query<WeekRow>(
      "SELECT week_start::text week,bike_id,owner_id,status,source,metrics,story,story_published_at,selected_at,window_start,window_end FROM bike_weeks WHERE week_start=$1",
      [week],
    )
  ).rows[0] || null;
async function isEligible(q: Queryable, id: string, owner: string | null) {
  return !!(
    await q.query(
      `SELECT b.id FROM bikes b JOIN users u ON u.id=b.owner_id WHERE b.id=$1 AND b.owner_id=$2 AND ${eligible}`,
      [id, owner],
    )
  ).rows.length;
}
async function history(
  q: Queryable,
  week: string,
  event: string,
  bike: string | null,
  owner: string | null,
  metrics: object = {},
  actor: string | null = null,
  reason = "",
) {
  await q.query(
    "INSERT INTO bike_week_history(week_start,event,bike_id,owner_id,metrics,actor_id,reason) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [week, event, bike, owner, metrics, actor, reason],
  );
}
// Must run in a transaction. All worker/admin/owner writes take the same week
// lock. Automatic reruns keep the winner and never issue another notice.
export async function selectBikeWeek(
  q: Queryable,
  now = new Date(),
  applyDecision = false,
) {
  const week = bikeWeekStart(now);
  await q.query("SELECT pg_advisory_xact_lock(hashtextextended($1,281))", [
    week,
  ]);
  const settings = await getBikeWeekSettings(q);
  let current = await weekRow(q, week);
  if (!settings.enabled) return current;
  const decision = (
    await q.query<{ action: "override" | "skip"; bike_id: string | null }>(
      "SELECT action,bike_id FROM bike_week_decisions WHERE week_start=$1",
      [week],
    )
  ).rows[0];
  if (current?.status === "selected" && current.bike_id && !applyDecision) {
    if (await isEligible(q, current.bike_id, current.owner_id)) return current;
    await history(
      q,
      week,
      "invalidated",
      current.bike_id,
      current.owner_id,
      current.metrics,
    );
    // Do not restore an invalidated winner if the owner republishes it later.
    await q.query(
      "INSERT INTO bike_week_declines VALUES($1,$2) ON CONFLICT DO NOTHING",
      [week, current.bike_id],
    );
    await q.query(
      "UPDATE bike_weeks SET status='invalid',updated_at=now() WHERE week_start=$1",
      [week],
    );
    current = await weekRow(q, week);
  }
  if (
    current &&
    ["empty", "skipped"].includes(current.status) &&
    !applyDecision
  )
    return current;
  const { start, end } = windowFor(week, settings.windowDays);
  let winner: Candidate | undefined;
  if (decision?.action !== "skip") {
    // A manual choice bypasses popularity/cooldown, never visibility or refusal.
    if (decision?.action === "override")
      winner = (await candidates(q, week, settings, decision.bike_id, 1))[0];
    // Invalid manual winners fall back to the automatic formula safely.
    winner ||= (await candidates(q, week, settings, null, 1))[0];
    if (winner) {
      // Match normal mutations' users -> bikes lock order; recheck after locks.
      await q.query("SELECT id FROM users WHERE id=$1 FOR SHARE", [
        winner.owner_id,
      ]);
      await q.query("SELECT id FROM bikes WHERE id=$1 FOR SHARE", [winner.id]);
      if (!(await isEligible(q, winner.id, winner.owner_id)))
        winner = undefined;
    }
  }
  if (winner && current?.status === "selected" && current.bike_id === winner.id)
    return current;
  const status =
    decision?.action === "skip" ? "skipped" : winner ? "selected" : "empty";
  const source =
    decision?.action === "skip"
      ? "skip"
      : decision?.bike_id === winner?.id && winner
        ? "override"
        : "automatic";
  const metrics = winner
    ? {
        likes: winner.likes,
        reactions: winner.reactions,
        participants: winner.participants,
        score: winner.score,
      }
    : {};
  await q.query(
    `INSERT INTO bike_weeks(week_start,bike_id,owner_id,status,source,metrics,settings,window_start,window_end,selected_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,CASE WHEN $2::uuid IS NULL THEN NULL ELSE now() END)
    ON CONFLICT(week_start) DO UPDATE SET bike_id=excluded.bike_id,owner_id=excluded.owner_id,status=excluded.status,source=excluded.source,metrics=excluded.metrics,settings=excluded.settings,window_start=excluded.window_start,window_end=excluded.window_end,selected_at=excluded.selected_at,story='',story_published_at=NULL,updated_at=now()`,
    [
      week,
      winner?.id || null,
      winner?.owner_id || null,
      status,
      source,
      metrics,
      settings,
      start,
      end,
    ],
  );
  await history(
    q,
    week,
    status,
    winner?.id || null,
    winner?.owner_id || null,
    metrics,
  );
  if (winner)
    await q.query(
      `INSERT INTO notifications(id,recipient_id,actor_id,type,bike_id,dedup_key)
    VALUES($1,$2,NULL,'bike_week',$3,$4) ON CONFLICT(recipient_id,dedup_key) DO NOTHING`,
      [
        randomUUID(),
        winner.owner_id,
        winner.id,
        `bike_week:${week}:${winner.id}`,
      ],
    );
  return weekRow(q, week);
}

export async function bikeWeekPreview(q: Queryable, week = bikeWeekStart()) {
  const settings = await getBikeWeekSettings(q);
  const current = await weekRow(q, week);
  const decision =
    (
      await q.query<{
        action: "override" | "skip";
        bike_id: string | null;
        reason: string;
      }>(
        "SELECT action,bike_id,reason FROM bike_week_decisions WHERE week_start=$1",
        [week],
      )
    ).rows[0] || null;
  const ranked = await candidates(q, week, settings);
  const ids = [
    ...ranked.map((b) => b.id),
    current?.bike_id,
    decision?.bike_id,
  ].filter((id): id is string => !!id);
  const details = (
    await q.query<BikeWeekChoice>(
      `SELECT ${choiceFields} FROM bikes b JOIN users u ON u.id=b.owner_id
     WHERE b.id=ANY($1::uuid[]) AND ${eligible}
       AND NOT EXISTS(SELECT 1 FROM bike_week_declines d WHERE d.week_start=$2::date AND d.bike_id=b.id)`,
      [ids, week],
    )
  ).rows;
  return {
    week,
    settings,
    window: windowFor(week, settings.windowDays),
    current,
    currentBike: details.find((b) => b.id === current?.bike_id) || null,
    decisionBike: details.find((b) => b.id === decision?.bike_id) || null,
    candidates: ranked.map((b) => ({
      ...b,
      bike: details.find((d) => d.id === b.id) || null,
    })),
    decision,
  };
}
export async function decideBikeWeek(
  q: Queryable,
  actor: string,
  input: z.infer<typeof bikeWeekDecisionInput>,
  now = new Date(),
) {
  const current = bikeWeekStart(now);
  if (
    input.week < current ||
    new Date(input.week).getTime() >
      new Date(current).getTime() + 366 * 86400000
  )
    throw new CommunityError(
      "Выберите текущую или будущую неделю в пределах года",
    );
  await q.query("SELECT pg_advisory_xact_lock(hashtextextended($1,281))", [
    input.week,
  ]);
  if (
    input.action === "override" &&
    !(
      await candidates(
        q,
        input.week,
        await getBikeWeekSettings(q),
        input.bikeId,
        1,
      )
    ).length
  )
    throw new CommunityError("Велосипед недоступен для рубрики", 409);
  if (input.action === "automatic")
    await q.query("DELETE FROM bike_week_decisions WHERE week_start=$1", [
      input.week,
    ]);
  else
    await q.query(
      `INSERT INTO bike_week_decisions(week_start,action,bike_id,actor_id,reason) VALUES($1,$2,$3,$4,$5) ON CONFLICT(week_start) DO UPDATE SET action=excluded.action,bike_id=excluded.bike_id,actor_id=excluded.actor_id,reason=excluded.reason`,
      [
        input.week,
        input.action,
        input.action === "override" ? input.bikeId : null,
        actor,
        input.reason,
      ],
    );
  await history(
    q,
    input.week,
    input.action,
    input.bikeId,
    null,
    {},
    actor,
    input.reason,
  );
  await audit(q, actor, "bike-week." + input.action, JSON.stringify(input));
  if (input.week === current) await selectBikeWeek(q, now, true);
  return bikeWeekPreview(q, input.week);
}

// Read-only and constant-size: no candidate ranking from the homepage.
// A withdrawn/blocked winner disappears on the next read; the worker replaces
// it on its next tick. Internal scoring, history and the full BOM stay private.
export async function currentBikeWeek(q: Queryable, now = new Date()) {
  const r = (
    await q.query<{
      week: string;
      selected_at: Date;
      story: string;
      story_published_at: Date | null;
      id: string;
      share_id: string;
      name: string;
      brand: string;
      model: string;
      description: string;
      owner_id: string;
      owner_name: string;
      username: string;
      avatar_id: string | null;
      photo_id: string;
      components: {
        category: string;
        name: string;
        groupId: string;
        modelId: string | null;
      }[];
    }>(
      `SELECT w.week_start::text week,w.selected_at,w.story,w.story_published_at,
    b.id,b.share_id,b.name,b.brand,b.model,left(b.description,1000) description,
    u.id owner_id,u.name owner_name,u.username,u.avatar_id,
    (SELECT id FROM photos WHERE bike_id=b.id ORDER BY is_cover DESC,created_at,id LIMIT 1) photo_id,
    (SELECT coalesce(jsonb_agg(jsonb_build_object('category',p.category,'name',p.name,'groupId',p.group_id,'modelId',p.model_id) ORDER BY p.priority,p.category),'[]') FROM (
      SELECT * FROM (SELECT DISTINCT ON (component_key(category)) category,name,group_id,model_id,
        CASE category WHEN 'Рама' THEN 1 WHEN 'Вилка' THEN 2 WHEN 'Групсет' THEN 3 WHEN 'Тормоза' THEN 4 WHEN 'Колёса' THEN 5 WHEN 'Покрышки' THEN 6 WHEN 'Задний переключатель' THEN 7 WHEN 'Ремень' THEN 8 WHEN 'Система / шатуны' THEN 9 WHEN 'Втулки' THEN 10 WHEN 'Седло' THEN 11 WHEN 'Руль' THEN 12 ELSE 20 END priority
        FROM components WHERE bike_id=b.id AND section='build' AND trim(name)<>'' AND trim(category)<>''
        ORDER BY component_key(category),sort_order,created_at,id) unique_parts ORDER BY priority,category LIMIT 7
    ) p) components
    FROM bike_weeks w JOIN bikes b ON b.id=w.bike_id AND b.owner_id=w.owner_id JOIN users u ON u.id=b.owner_id
    JOIN bike_week_settings s ON s.id=1
    WHERE w.week_start=$1 AND w.status='selected' AND coalesce((s.value->>'enabled')::boolean,true) AND ${eligible}`,
      [bikeWeekStart(now)],
    )
  ).rows[0];
  if (!r) return null;
  return {
    weekStart: r.week,
    selectedAt: r.selected_at,
    bike: {
      id: r.id,
      shareId: r.share_id,
      name: r.name,
      brand: r.brand,
      model: r.model,
    },
    cover: { id: r.photo_id, url: `/api/photos/${r.photo_id}?width=640` },
    owner: publicAuthor({
      id: r.owner_id,
      name: r.owner_name,
      username: r.username,
      avatar_id: r.avatar_id,
    }),
    text: r.story_published_at ? r.story : plainExcerpt(r.description, 600),
    textSource: r.story_published_at
      ? ("owner" as const)
      : ("description" as const),
    components: r.components.map((p) => ({
      ...p,
      category: p.category.normalize("NFKC").trim(),
      name: p.name.normalize("NFKC").trim(),
    })),
  };
}
export async function ownerBikeWeek(
  q: Queryable,
  owner: string,
  now = new Date(),
) {
  const dto = await currentBikeWeek(q, now);
  if (dto?.owner.id !== owner) return null;
  return { ...dto, story: dto.textSource === "owner" ? dto.text : "" };
}
export async function updateBikeWeekStory(
  q: Queryable,
  owner: string,
  input: z.infer<typeof bikeWeekStoryInput>,
  now = new Date(),
) {
  const week = bikeWeekStart(now);
  await q.query("SELECT pg_advisory_xact_lock(hashtextextended($1,281))", [
    week,
  ]);
  const current = await ownerBikeWeek(q, owner, now);
  if (!current) throw new CommunityError("Участие недоступно", 404);
  await q.query("SELECT id FROM users WHERE id=$1 FOR SHARE", [owner]);
  await q.query("SELECT id FROM bikes WHERE id=$1 FOR SHARE", [
    current.bike.id,
  ]);
  if (!(await isEligible(q, current.bike.id, owner)))
    throw new CommunityError("Участие недоступно", 404);
  if (input.action === "decline") {
    await q.query(
      "INSERT INTO bike_week_declines VALUES($1,$2) ON CONFLICT DO NOTHING",
      [week, current.bike.id],
    );
    await q.query(
      "UPDATE bike_weeks SET status='invalid',story='',story_published_at=NULL,updated_at=now() WHERE week_start=$1",
      [week],
    );
    await history(q, week, "declined", current.bike.id, owner, {}, owner);
    // Replacement is done by the worker to keep this transaction's lock set small.
    return null;
  }
  await q.query(
    "UPDATE bike_weeks SET story=$2,story_published_at=now(),updated_at=now() WHERE week_start=$1",
    [week, input.text],
  );
  await history(q, week, "story-published", current.bike.id, owner, {}, owner);
  return ownerBikeWeek(q, owner, now);
}
