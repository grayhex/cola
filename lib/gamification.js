import {
  achievements,
  recordDefinitions,
  reactions,
} from "./gamification-definitions.js";
import { gameSettings } from "./gamification-validation.js";
import { getSite, audit } from "./site.js";
import { scoreBike } from "./bike-score.js";
import { publicAuthor } from "./profile-dto.js";
import { CommunityError } from "./community-validation.js";
export async function getGameSettings(q) {
  return gameSettings(
    (await q.query("SELECT value FROM gamification_settings WHERE id=1"))
      .rows[0]?.value,
  );
}
// One bulk snapshot: hidden prices are removed by SQL before reaching the scoring/ranking layer.
// Children aggregate once per relation, not once per badge or bike card.
export const leaderboardSQL = `WITH parts AS (
 SELECT bike_id,jsonb_agg(jsonb_build_object('section',section,'category',category,'name',name,'group_id',group_id)) AS components FROM components GROUP BY bike_id
), images AS (SELECT bike_id,jsonb_agg(jsonb_build_object('id',id) ORDER BY is_cover DESC,created_at,id) AS photos FROM photos GROUP BY bike_id),
 likes AS (SELECT l.bike_id,count(*)::int AS likes FROM bike_likes l JOIN users u ON u.id=l.user_id JOIN bikes b ON b.id=l.bike_id WHERE NOT u.blocked AND l.user_id<>b.owner_id GROUP BY l.bike_id),
 votes AS (SELECT r.bike_id,count(*) FILTER(WHERE kind='wild')::int AS wild,count(*) FILTER(WHERE kind='clean')::int AS clean,count(*) FILTER(WHERE kind='dream')::int AS dream,count(DISTINCT r.user_id)::int AS community FROM bike_reactions r JOIN users u ON u.id=r.user_id JOIN bikes b ON b.id=r.bike_id WHERE NOT u.blocked AND r.user_id<>b.owner_id GROUP BY r.bike_id)
 SELECT b.id,b.owner_id,b.share_id,b.name,b.brand,b.model,b.year,b.category,b.weight,b.show_bike_price,
 CASE WHEN b.show_bike_price THEN b.price ELSE NULL END AS price,
 u.username,u.name AS owner_name,u.avatar_id,
 coalesce(p.components,'[]') AS components,coalesce(i.photos,'[]') AS photos,
 coalesce(l.likes,0) AS likes,coalesce(v.wild,0) AS wild,coalesce(v.clean,0) AS clean,coalesce(v.dream,0) AS dream,coalesce(v.community,0) AS community
 FROM bikes b JOIN users u ON u.id=b.owner_id LEFT JOIN parts p ON p.bike_id=b.id LEFT JOIN images i ON i.bike_id=b.id LEFT JOIN likes l ON l.bike_id=b.id LEFT JOIN votes v ON v.bike_id=b.id
 WHERE b.is_public AND NOT u.blocked AND NOT b.leaderboard_excluded`;
export function rankRecords(rows, settings, site) {
  const candidates = rows.map((b) => ({
    ...b,
    ...scoreBike(b, site.settings.scoring, site.catalog.componentGroups),
  }));
  return recordDefinitions
    .filter(
      (d) =>
        settings.enabledRecords.includes(d.key) &&
        (settings.reactionsEnabled || d.group !== "Community"),
    )
    .map((d) => {
      const valid = candidates
        .filter((b) => {
          if (b.completeness < settings.minimumCompleteness) return false;
          if (d.category && b.category !== d.category) return false;
          if (d.metric === "price")
            return (
              b.show_bike_price &&
              Number(b.price) > 0 &&
              (d.key !== "budget" ||
                (Number(b.price) > settings.budgetMinimum &&
                  b.photos.length &&
                  b.brand.trim() &&
                  b.model.trim() &&
                  b.year))
            );
          if (d.metric === "weight")
            return (
              Number(b.weight) >= settings.weightMinimum &&
              Number(b.weight) <= settings.weightMaximum
            );
          return Number(b[d.metric]) > 0;
        })
        .sort(
          (a, b) =>
            (Number(a[d.metric]) - Number(b[d.metric])) *
              (d.direction === "asc" ? 1 : -1) || a.id.localeCompare(b.id),
        );
      const b = valid[0];
      return {
        key: d.key,
        name: d.name,
        group: d.group,
        metric: d.metric,
        category: d.category || null,
        eligible: valid.length,
        holder: b
          ? {
              id: b.id,
              shareId: b.share_id,
              name: b.name,
              cover: b.photos[0]?.id || null,
              category: b.category,
              author: publicAuthor({
                id: b.owner_id,
                username: b.username,
                name: b.owner_name,
                avatar_id: b.avatar_id,
              }),
              value: Number(b[d.metric]),
            }
          : null,
      };
    });
}
export async function records(q) {
  const settings = await getGameSettings(q),
    site = await getSite(q),
    r = await q.query(leaderboardSQL);
  return {
    asOf: new Date().toISOString(),
    settings,
    records: rankRecords(r.rows, settings, site),
  };
}
export async function awardShelf(
  q,
  { userId = null, bikeId = null, privateView = false } = {},
) {
  const r = await q.query(
    `SELECT a.achievement_key,a.awarded_at,a.bike_id FROM achievement_awards a JOIN users u ON u.id=a.user_id LEFT JOIN bikes b ON b.id=a.bike_id
 WHERE NOT u.blocked AND ($1::uuid IS NULL OR a.user_id=$1) AND ($2::uuid IS NULL OR a.bike_id=$2) AND (a.bike_id IS NULL OR b.is_public OR $3)
 ORDER BY a.awarded_at DESC,a.id DESC`,
    [userId, bikeId, privateView],
  );
  return r.rows.flatMap((a) => {
    const d = achievements.find((d) => d.key === a.achievement_key);
    return d
      ? [
          {
            key: d.key,
            name: d.name,
            description: d.description,
            scope: d.scope,
            bikeId: a.bike_id,
            awardedAt: a.awarded_at,
          },
        ]
      : [];
  });
}
export async function gameShelf(q, options) {
  const awards = await awardShelf(q, options),
    hall = await records(q);
  return {
    awards,
    records: hall.records.filter(
      (r) =>
        r.holder &&
        (options.bikeId
          ? r.holder.id === options.bikeId
          : r.holder.author.id === options.userId),
    ),
    asOf: hall.asOf,
  };
}
export async function accountAchievements(q, id) {
  const shelf = await gameShelf(q, { userId: id, privateView: true });
  const r = (
    await q.query(
      `SELECT
 (SELECT count(*) FROM bikes WHERE owner_id=$1 AND is_public) AS bikes,
 (SELECT count(DISTINCT category) FROM bikes WHERE owner_id=$1 AND is_public) AS categories,
 (SELECT count(*) FROM bike_likes l JOIN users u ON u.id=l.user_id JOIN bikes b ON b.id=l.bike_id WHERE b.owner_id=$1 AND b.is_public AND NOT u.blocked AND l.user_id<>$1) AS likes,
 (SELECT count(*) FROM user_follows f JOIN users u ON u.id=f.follower_id WHERE f.following_id=$1 AND NOT u.blocked) AS followers,
 (SELECT count(DISTINCT c.bike_id) FROM bike_comments c JOIN bikes b ON b.id=c.bike_id JOIN users u ON u.id=b.owner_id WHERE c.author_id=$1 AND c.deleted_at IS NULL AND b.is_public AND b.owner_id<>$1 AND NOT u.blocked) AS discussions`,
      [id],
    )
  ).rows[0];
  return {
    ...shelf,
    locked: achievements
      .filter((d) => !shelf.awards.some((a) => a.key === d.key))
      .map((d) => ({
        key: d.key,
        name: d.name,
        description: d.description,
        target: d.target,
        progress:
          d.scope === "user" ? Math.min(d.target, Number(r[d.metric])) : null,
      })),
  };
}
export async function reactionState(q, bikeId, viewerId) {
  const b = (
    await q.query(
      "SELECT b.owner_id FROM bikes b JOIN users u ON u.id=b.owner_id WHERE b.id=$1 AND b.is_public AND NOT u.blocked",
      [bikeId],
    )
  ).rows[0];
  if (!b) throw new CommunityError("Велосипед недоступен", 404);
  const settings = await getGameSettings(q);
  const result = await q.query(
    `SELECT r.kind,count(*)::int AS count,coalesce(bool_or(r.user_id=$2),false) AS selected FROM bike_reactions r JOIN users u ON u.id=r.user_id WHERE r.bike_id=$1 AND NOT u.blocked AND r.user_id<>$3 GROUP BY r.kind`,
    [bikeId, viewerId || null, b.owner_id],
  );
  return {
    enabled: settings.reactionsEnabled,
    isOwner: viewerId === b.owner_id,
    reactions: Object.entries(reactions).map(([key, name]) => {
      const r = result.rows.find((r) => r.kind === key);
      return {
        key,
        name,
        count: settings.reactionsEnabled ? r?.count || 0 : 0,
        selected: settings.reactionsEnabled && !!r?.selected,
      };
    }),
  };
}
export async function reactToBike(q, bikeId, userId, kind, enabled) {
  const b = (
    await q.query(
      "SELECT b.owner_id,b.is_public,u.blocked FROM bikes b JOIN users u ON u.id=b.owner_id WHERE b.id=$1 FOR UPDATE OF b",
      [bikeId],
    )
  ).rows[0];
  if (!b || !b.is_public || b.blocked)
    throw new CommunityError("Велосипед недоступен", 404);
  if (b.owner_id === userId)
    throw new CommunityError("Нельзя голосовать за свой велосипед", 403);
  if (
    !(
      await q.query("SELECT id FROM users WHERE id=$1 AND NOT blocked", [
        userId,
      ])
    ).rows.length
  )
    throw new CommunityError("Войдите в аккаунт", 401);
  if (!(await getGameSettings(q)).reactionsEnabled)
    throw new CommunityError("Реакции отключены", 409);
  if (enabled)
    await q.query(
      "INSERT INTO bike_reactions(bike_id,user_id,kind) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
      [bikeId, userId, kind],
    );
  else
    await q.query(
      "DELETE FROM bike_reactions WHERE bike_id=$1 AND user_id=$2 AND kind=$3",
      [bikeId, userId, kind],
    );
  return reactionState(q, bikeId, userId);
}
export async function excludeBike(q, actor, bikeId, input) {
  const r = await q.query(
    "UPDATE bikes SET leaderboard_excluded=$2 WHERE id=$1 RETURNING id",
    [bikeId, input.excluded],
  );
  if (!r.rows.length) throw new CommunityError("Велосипед не найден", 404);
  await audit(
    q,
    actor,
    input.excluded ? "leaderboard.exclude" : "leaderboard.restore",
    bikeId + " " + input.reason,
  );
  return { ok: true };
}
// One query for all cards, only achievements of currently public bikes. Never a per-card query.
export async function cardBadges(q, ids) {
  const rows = (
    await q.query(
      `SELECT a.bike_id,a.achievement_key FROM achievement_awards a JOIN bikes b ON b.id=a.bike_id JOIN users u ON u.id=b.owner_id WHERE a.bike_id=ANY($1::uuid[]) AND b.is_public AND NOT u.blocked ORDER BY a.awarded_at DESC,a.id DESC`,
      [ids],
    )
  ).rows;
  const map = new Map(ids.map((id) => [id, []]));
  for (const a of rows) {
    const d = achievements.find((d) => d.key === a.achievement_key),
      list = map.get(a.bike_id);
    if (d && list.length < 2) list.push({ key: d.key, name: d.name });
  }
  return map;
}
