import { reactions } from "./gamification-definitions.js";
import { gameSettings } from "./gamification-validation.js";
import { getSite, audit } from "./site.js";
import { scoreBike } from "./bike-score.js";
import { publicAuthor } from "./profile-dto.js";
import { personName } from "./usernames.js";
import { CommunityError } from "./community-validation.js";
import { metricByKey } from "./game-metrics.js";
import { loadRules } from "./game-rules.js";
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

const author = (r) =>
  publicAuthor({
    id: r.owner_id,
    username: r.username,
    name: r.owner_name,
    avatar_id: r.avatar_id,
  });

// Bikes of the rating that a bike record can hold: the completeness
// threshold, a shown price (a minimum price also needs the budget
// conditions), the admin's weight bounds, a known year.
export function rankBikes(rule, candidates, settings) {
  const m = rule.metric;
  return candidates
    .filter((b) => {
      if (b.completeness < settings.minimumCompleteness) return false;
      if (rule.category && b.category !== rule.category) return false;
      if (m === "price")
        return (
          b.show_bike_price &&
          Number(b.price) > 0 &&
          (rule.direction !== "min" ||
            (Number(b.price) > settings.budgetMinimum &&
              b.photos.length &&
              b.brand.trim() &&
              b.model.trim() &&
              b.year))
        );
      if (m === "weight")
        return (
          Number(b.weight) >= settings.weightMinimum &&
          Number(b.weight) <= settings.weightMaximum
        );
      if (m === "year") return Number(b.year) >= 1900;
      return Number(b[m]) > 0;
    })
    .sort(
      (a, b) =>
        (Number(a[m]) - Number(b[m])) * (rule.direction === "min" ? 1 : -1) ||
        a.id.localeCompare(b.id),
    );
}

// Ride and person records come from the metric functions of the database,
// which count only public data.
async function rideHolder(q, rule) {
  const r = (
    await q.query(
      `SELECT v.value,r.id,r.share_id,r.title,b.id AS bike_id,b.share_id AS bike_share_id,b.name AS bike_name,
        u.id AS owner_id,u.username,u.name AS owner_name,u.avatar_id,count(*) OVER() AS eligible
       FROM game_ride_values($1,$2,$3,NULL) v JOIN rides r ON r.id=v.ride_id
       JOIN bikes b ON b.id=v.bike_id JOIN users u ON u.id=v.user_id
       WHERE NOT b.leaderboard_excluded
       ORDER BY v.value ${rule.direction === "min" ? "ASC" : "DESC"},r.id LIMIT 1`,
      [rule.metric, rule.category, rule.minDistanceKm],
    )
  ).rows[0];
  return r
    ? {
        eligible: Number(r.eligible),
        holder: {
          kind: "ride",
          id: r.id,
          shareId: r.share_id,
          name: r.title,
          bike: { id: r.bike_id, shareId: r.bike_share_id, name: r.bike_name },
          author: author(r),
          value: Number(r.value),
        },
      }
    : { eligible: 0, holder: null };
}
async function personHolder(q, rule) {
  const r = (
    await q.query(
      `SELECT v.value,u.id AS owner_id,u.username,u.name AS owner_name,u.avatar_id,count(*) OVER() AS eligible
       FROM game_user_values($1,$2,NULL) v JOIN users u ON u.id=v.user_id
       WHERE v.value>0
       ORDER BY v.value ${rule.direction === "min" ? "ASC" : "DESC"},u.id LIMIT 1`,
      [rule.metric, rule.category],
    )
  ).rows[0];
  return r
    ? {
        eligible: Number(r.eligible),
        holder: {
          kind: "profile",
          id: r.owner_id,
          name: personName(author(r)),
          author: author(r),
          value: Number(r.value),
        },
      }
    : { eligible: 0, holder: null };
}

function recordDto(rule, { eligible, holder }) {
  return {
    key: rule.key,
    name: rule.name,
    description: rule.description,
    imageId: rule.imageId,
    group: metricByKey[rule.metric].group,
    metric: rule.metric,
    subject: rule.subject,
    direction: rule.direction,
    category: rule.category,
    eligible,
    holder,
  };
}

export async function records(q) {
  const settings = await getGameSettings(q);
  const rules = (await loadRules(q)).filter(
    (r) =>
      r.kind === "record" &&
      r.enabled &&
      metricByKey[r.metric] &&
      (settings.reactionsEnabled || !metricByKey[r.metric].reactions),
  );
  const site = await getSite(q);
  const bikes = rules.some((r) => r.subject === "bike")
    ? (await q.query(leaderboardSQL)).rows.map((b) => ({
        ...b,
        ...scoreBike(b, site.settings.scoring, site.catalog.componentGroups),
      }))
    : [];
  const list = [];
  for (const rule of rules) {
    if (rule.subject === "ride")
      list.push(recordDto(rule, await rideHolder(q, rule)));
    else if (rule.subject === "user")
      list.push(recordDto(rule, await personHolder(q, rule)));
    else {
      const valid = rankBikes(rule, bikes, settings),
        b = valid[0];
      list.push(
        recordDto(rule, {
          eligible: valid.length,
          holder: b
            ? {
                kind: "bike",
                id: b.id,
                shareId: b.share_id,
                name: b.name,
                cover: b.photos[0]?.id || null,
                category: b.category,
                author: author(b),
                value: Number(b[rule.metric]),
              }
            : null,
        }),
      );
    }
  }
  return { asOf: new Date().toISOString(), settings, records: list };
}

// Awards everybody can see, with how many people have each: blocked people
// and awards of bikes that are not public are not counted.
export async function awardCatalog(q) {
  const counts = new Map(
    (
      await q.query(
        `SELECT a.achievement_key AS key,count(DISTINCT a.user_id)::int AS earners
         FROM achievement_awards a JOIN users u ON u.id=a.user_id LEFT JOIN bikes b ON b.id=a.bike_id
         WHERE NOT u.blocked AND (a.bike_id IS NULL OR b.is_public)
         GROUP BY a.achievement_key`,
      )
    ).rows.map((r) => [r.key, r.earners]),
  );
  return (await loadRules(q))
    .filter((r) => r.kind === "award" && r.enabled && metricByKey[r.metric])
    .map((r) => ({
      key: r.key,
      name: r.name,
      description: r.description,
      imageId: r.imageId,
      group: metricByKey[r.metric].group,
      metric: r.metric,
      subject: r.subject,
      comparison: r.comparison,
      threshold: r.threshold,
      earners: counts.get(r.key) || 0,
    }));
}

export async function awardShelf(
  q,
  { userId = null, bikeId = null, privateView = false } = {},
) {
  const r = await q.query(
    `SELECT a.achievement_key,a.awarded_at,a.bike_id,g.name,g.description,g.image_id,g.subject
     FROM achievement_awards a JOIN game_rules g ON g.key=a.achievement_key AND g.enabled
     JOIN users u ON u.id=a.user_id LEFT JOIN bikes b ON b.id=a.bike_id
     WHERE NOT u.blocked AND ($1::uuid IS NULL OR a.user_id=$1) AND ($2::uuid IS NULL OR a.bike_id=$2) AND (a.bike_id IS NULL OR b.is_public OR $3)
     ORDER BY a.awarded_at DESC,g.position,a.id DESC`,
    [userId, bikeId, privateView],
  );
  return r.rows.map((a) => ({
    key: a.achievement_key,
    name: a.name,
    description: a.description,
    imageId: a.image_id,
    scope: a.subject === "bike" ? "bike" : "user",
    bikeId: a.bike_id,
    awardedAt: a.awarded_at,
  }));
}
// A record belongs to a bike's shelf when the bike holds it or a ride on it
// does, and to a person's shelf when they hold it through anything.
export const holdsRecord = (record, { bikeId = null, userId = null }) =>
  !!record.holder &&
  (bikeId
    ? (record.holder.kind === "bike" && record.holder.id === bikeId) ||
      (record.holder.kind === "ride" && record.holder.bike.id === bikeId)
    : record.holder.author.id === userId);
export async function gameShelf(q, options) {
  const awards = await awardShelf(q, options),
    hall = await records(q);
  return {
    awards,
    records: hall.records.filter((r) => holdsRecord(r, options)),
    asOf: hall.asOf,
  };
}
// Progress towards awards the person does not have yet: a person's metric,
// or the best of their public rides. A bike award has no single progress.
async function progress(q, rule, userId) {
  if (rule.subject === "user")
    return Number(
      (
        await q.query("SELECT value FROM game_user_values($1,$2,$3)", [
          rule.metric,
          rule.category,
          userId,
        ])
      ).rows[0]?.value || 0,
    );
  if (rule.subject === "ride") {
    const best = (
      await q.query(
        `SELECT ${rule.comparison === "lte" ? "min" : "max"}(value) AS value FROM game_ride_values($1,$2,$3,$4)`,
        [rule.metric, rule.category, rule.minDistanceKm, userId],
      )
    ).rows[0]?.value;
    return best == null ? 0 : Number(best);
  }
  return null;
}
export async function accountAchievements(q, id) {
  const shelf = await gameShelf(q, { userId: id, privateView: true });
  const earned = new Set(shelf.awards.map((a) => a.key));
  const locked = [];
  for (const rule of (await loadRules(q)).filter(
    (r) => r.kind === "award" && r.enabled && !earned.has(r.key),
  )) {
    const value = await progress(q, rule, id);
    locked.push({
      key: rule.key,
      name: rule.name,
      description: rule.description,
      imageId: rule.imageId,
      target: rule.threshold,
      comparison: rule.comparison,
      metric: rule.metric,
      progress:
        value === null || rule.comparison === "lte"
          ? null
          : Math.min(rule.threshold, Math.round(value * 100) / 100),
    });
  }
  return { ...shelf, locked };
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
/** @param {import("./gamification-validation.js").ExclusionInput} input */
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
// One query for all cards, only awards of currently public bikes. Never a per-card query.
export async function cardBadges(q, ids) {
  const rows = (
    await q.query(
      `SELECT a.bike_id,a.achievement_key,g.name FROM achievement_awards a JOIN game_rules g ON g.key=a.achievement_key AND g.enabled
       JOIN bikes b ON b.id=a.bike_id JOIN users u ON u.id=b.owner_id
       WHERE a.bike_id=ANY($1::uuid[]) AND b.is_public AND NOT u.blocked ORDER BY a.awarded_at DESC,a.id DESC`,
      [ids],
    )
  ).rows;
  const map = new Map(ids.map((id) => [id, []]));
  for (const a of rows) {
    const list = map.get(a.bike_id);
    if (list.length < 2) list.push({ key: a.achievement_key, name: a.name });
  }
  return map;
}
