import type { SiteDefinition } from "./contracts.ts";
import type { ExclusionInput as ExclusionInputType } from "./gamification-validation.ts";
import type { GameRule } from "./game-rules.ts";
interface GameAuthor {
  owner_id: string;
  username: string;
  owner_name: string;
  avatar_id: string | null;
}
interface LeaderboardBike extends GameAuthor {
  id: string;
  share_id: string;
  name: string;
  brand: string;
  model: string;
  year: number;
  category: string;
  weight: string | null;
  show_bike_price: boolean;
  price: string | null;
  part_count: number;
  cover_id: string | null;
  likes: number;
  wild: number;
  clean: number;
  dream: number;
  community: number;
}
interface HolderBase {
  id: string;
  name: string;
  author: PublicAuthor;
  value: number;
}
export type RecordHolder =
  | (HolderBase & {
      kind: "bike";
      shareId: string;
      cover: string | null;
      category: string;
    })
  | (HolderBase & {
      kind: "ride";
      shareId: string;
      bike: { id: string; shareId: string; name: string };
    })
  | (HolderBase & { kind: "profile" });
interface HolderResult {
  eligible: number;
  holder: RecordHolder | null;
}
interface ShelfOptions {
  userId?: string | null;
  bikeId?: string | null;
  privateView?: boolean;
}
export type GameRecord = ReturnType<typeof recordDto>;
import type { Queryable } from "./db.ts";
import { reactions } from "./gamification-definitions.ts";
import { gameSettings } from "./gamification-validation.ts";
import { getSite, audit } from "./site.ts";
import {
  bikeCompleteness,
  upgradeFromPoints,
  normalizedScoreText,
} from "./bike-score.ts";
import { publicAuthor } from "./profile-dto.ts";
import { personName } from "./usernames.ts";
import { CommunityError } from "./community-validation.ts";
import { metricByKey } from "./game-metrics.ts";
import { loadRules } from "./game-rules.ts";
import type { PublicAuthor } from "./contracts.ts";
export async function getGameSettings(q: Queryable) {
  return gameSettings(
    (
      await q.query<{ value: unknown }>(
        "SELECT value FROM gamification_settings WHERE id=1",
      )
    ).rows[0]?.value,
  );
}
// One bulk snapshot: hidden prices are removed by SQL before reaching the scoring/ranking layer.
// Children aggregate once per relation, not once per badge or bike card.
// ECMAScript String.trim's exact whitespace set, including NBSP and BOM.
const scoreNamePresent = (column: "name" | "p.name") =>
  String.raw`btrim(${column}, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')<>''`;
export const leaderboardSQL = `WITH parts AS (
 SELECT bike_id,count(DISTINCT trim(regexp_replace(lower(normalize(category,NFKC)),'[^[:alnum:]]+',' ','g'))||'|'||trim(regexp_replace(lower(normalize(name,NFKC)),'[^[:alnum:]]+',' ','g')))::int AS part_count FROM components WHERE section='build' AND ${scoreNamePresent("name")} GROUP BY bike_id
), images AS (SELECT DISTINCT ON (bike_id) bike_id,id AS cover_id FROM photos ORDER BY bike_id,is_cover DESC,created_at,id),
 likes AS (SELECT l.bike_id,count(*)::int AS likes FROM bike_likes l JOIN users u ON u.id=l.user_id JOIN bikes b ON b.id=l.bike_id WHERE NOT u.blocked AND l.user_id<>b.owner_id GROUP BY l.bike_id),
 votes AS (SELECT r.bike_id,count(*) FILTER(WHERE kind='wild')::int AS wild,count(*) FILTER(WHERE kind='clean')::int AS clean,count(*) FILTER(WHERE kind='dream')::int AS dream,count(DISTINCT r.user_id)::int AS community FROM bike_reactions r JOIN users u ON u.id=r.user_id JOIN bikes b ON b.id=r.bike_id WHERE NOT u.blocked AND r.user_id<>b.owner_id GROUP BY r.bike_id)
 SELECT b.id,b.owner_id,b.share_id,b.name,b.brand,b.model,b.year,b.category,b.weight,b.show_bike_price,
 CASE WHEN b.show_bike_price THEN b.price ELSE NULL END AS price,
 u.username,u.name AS owner_name,u.avatar_id,
 coalesce(p.part_count,0) AS part_count,i.cover_id,
 coalesce(l.likes,0) AS likes,coalesce(v.wild,0) AS wild,coalesce(v.clean,0) AS clean,coalesce(v.dream,0) AS dream,coalesce(v.community,0) AS community
 FROM bikes b JOIN users u ON u.id=b.owner_id LEFT JOIN parts p ON p.bike_id=b.id LEFT JOIN images i ON i.bike_id=b.id LEFT JOIN likes l ON l.bike_id=b.id LEFT JOIN votes v ON v.bike_id=b.id
 WHERE b.is_public AND NOT u.blocked AND NOT b.leaderboard_excluded`;

const author = (r: GameAuthor) =>
  publicAuthor({
    id: r.owner_id,
    username: r.username,
    name: r.owner_name,
    avatar_id: r.avatar_id,
  });

// Bikes of the rating that a bike record can hold: the completeness
// threshold, a shown price (a minimum price also needs the budget
// conditions), the admin's weight bounds, a known year.
type RankedBike = LeaderboardBike & { completeness: number; upgrade: number };
type GameSettings = Awaited<ReturnType<typeof getGameSettings>>;
function eligibleBike(rule: GameRule, b: RankedBike, settings: GameSettings) {
  if (
    b.completeness < settings.minimumCompleteness ||
    (rule.category && b.category !== rule.category)
  )
    return false;
  if (rule.metric === "price")
    return (
      b.show_bike_price &&
      Number(b.price) > 0 &&
      (rule.direction !== "min" ||
        (Number(b.price) > settings.budgetMinimum &&
          !!b.cover_id &&
          !!b.brand.trim() &&
          !!b.model.trim() &&
          !!b.year))
    );
  if (rule.metric === "weight")
    return (
      Number(b.weight) >= settings.weightMinimum &&
      Number(b.weight) <= settings.weightMaximum
    );
  if (rule.metric === "year") return Number(b.year) >= 1900;
  return bikeValue(b, rule.metric) > 0;
}
const bikeValue = (b: RankedBike, metric: string) =>
  Number(b[metric as keyof RankedBike]);
const compareBikes = (rule: GameRule, a: RankedBike, b: RankedBike) =>
  (bikeValue(a, rule.metric) - bikeValue(b, rule.metric)) *
    (rule.direction === "min" ? 1 : -1) || a.id.localeCompare(b.id);
// Kept as a reference for callers/tests needing a full ordering. Records uses
// a single linear scan per distinct scope, never sorts the catalog for top-1.
export function rankBikes(
  rule: GameRule,
  candidates: RankedBike[],
  settings: GameSettings,
) {
  return candidates
    .filter((b) => eligibleBike(rule, b, settings))
    .sort((a, b) => compareBikes(rule, a, b));
}
function bikeHolder(
  rule: GameRule,
  candidates: RankedBike[],
  settings: GameSettings,
): HolderResult {
  let eligible = 0,
    best: RankedBike | null = null;
  for (const b of candidates) {
    if (!eligibleBike(rule, b, settings)) continue;
    eligible++;
    if (!best || compareBikes(rule, b, best) < 0) best = b;
  }
  return {
    eligible,
    holder: best
      ? {
          kind: "bike",
          id: best.id,
          shareId: best.share_id,
          name: best.name,
          cover: best.cover_id,
          category: best.category,
          author: author(best),
          value: bikeValue(best, rule.metric),
        }
      : null,
  };
}

// Ride and person records come from the metric functions of the database,
// which count only public data.
type HolderPair = { min: HolderResult; max: HolderResult };
// Each metric/filter scope is evaluated once for both directions. Transfer at
// most two holders; neither all rides nor all people cross the DB boundary.
async function metricHolders(
  q: Queryable,
  rule: GameRule,
): Promise<HolderPair> {
  const ride = rule.subject === "ride";
  const source = ride
    ? `SELECT v.value,r.id,r.share_id,r.title,b.id bike_id,b.share_id bike_share_id,b.name bike_name,
    u.id owner_id,u.username,u.name owner_name,u.avatar_id
    FROM game_ride_values($1,$2,$3,NULL) v JOIN rides r ON r.id=v.ride_id JOIN bikes b ON b.id=v.bike_id JOIN users u ON u.id=v.user_id WHERE NOT b.leaderboard_excluded`
    : `SELECT v.value,u.id,u.id owner_id,u.username,u.name owner_name,u.avatar_id
    FROM game_user_values($1,$2,NULL) v JOIN users u ON u.id=v.user_id WHERE v.value>0`;
  const rows = (
    await q.query<
      GameAuthor & {
        direction: "min" | "max";
        value: string;
        eligible: string;
        id: string;
        share_id: string;
        title: string;
        bike_id: string;
        bike_share_id: string;
        bike_name: string;
      }
    >(
      `WITH vals AS MATERIALIZED (${source}), bounds AS (
    SELECT count(*) eligible,min(value) lo,max(value) hi FROM vals
  ), picked AS (
    SELECT eligible,(SELECT min(id::text) FROM vals WHERE value=bounds.lo) low_id,
      (SELECT min(id::text) FROM vals WHERE value=bounds.hi) high_id FROM bounds
  ) SELECT d.direction,v.*,p.eligible FROM picked p
    CROSS JOIN LATERAL (VALUES ('min',p.low_id),('max',p.high_id)) d(direction,id)
    JOIN vals v ON v.id::text=d.id`,
      ride
        ? [rule.metric, rule.category, rule.minDistanceKm]
        : [rule.metric, rule.category],
    )
  ).rows;
  const result: HolderPair = {
    min: { eligible: 0, holder: null },
    max: { eligible: 0, holder: null },
  };
  for (const r of rows)
    result[r.direction] = {
      eligible: Number(r.eligible),
      holder: ride
        ? {
            kind: "ride",
            id: r.id,
            shareId: r.share_id,
            name: r.title,
            bike: {
              id: r.bike_id,
              shareId: r.bike_share_id,
              name: r.bike_name,
            },
            author: author(r),
            value: Number(r.value),
          }
        : {
            kind: "profile",
            id: r.owner_id,
            name: personName(author(r)),
            author: author(r),
            value: Number(r.value),
          },
    };
  return result;
}

function recordDto(rule: GameRule, { eligible, holder }: HolderResult) {
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

// Explicit operation-local context, tied to the caller's query/transaction.
// Never put viewer data, promises or transaction clients in a module cache.
export interface GameContext {
  site?: SiteDefinition;
  settings?: GameSettings;
  rules?: GameRule[];
}
export async function gameContext(
  q: Queryable,
): Promise<Required<GameContext>> {
  return {
    site: await getSite(q),
    settings: await getGameSettings(q),
    rules: await loadRules(q),
  };
}
// Return scoring features, not full component names/notes. Match each custom
// rule once per bike with the same normalized tokens and group precedence as
// scoreBike. Disabled/private bikes and accessories never enter this aggregate.
async function upgradePoints(q: Queryable, site: SiteDefinition) {
  const rules = site.settings.scoring.rules
    .map((r, index) => ({
      ...r,
      index,
      tokens: normalizedScoreText(r.match).split(" ").filter(Boolean),
    }))
    .filter((r) => r.tokens.length);
  if (!rules.length) return new Map<string, number>();
  const rows = (
    await q.query<{ bike_id: string; points: string }>(
      `WITH rules AS (
    SELECT * FROM jsonb_to_recordset($1::jsonb) AS r(index int, "groupId" text, category text, tokens jsonb, points float8)
  ), matched AS (
    SELECT DISTINCT p.bike_id,r.index,r.points FROM components p
    JOIN bikes b ON b.id=p.bike_id AND b.is_public AND NOT b.leaderboard_excluded JOIN users u ON u.id=b.owner_id AND NOT u.blocked
    CROSS JOIN rules r
    WHERE p.section='build' AND ${scoreNamePresent("p.name")} AND (r.category='' OR r.category=p.category)
    AND (r."groupId"='' OR r."groupId"=coalesce(
      (SELECT g->>'id' FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY AS groups(g,pos)
       WHERE g->>'id'=p.group_id OR g->'categories' ? p.category ORDER BY (g->>'id'=p.group_id) DESC,pos LIMIT 1),'other'))
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(r.tokens) t(token)
      WHERE strpos(' '||trim(regexp_replace(lower(normalize(p.name,NFKC)),'[^[:alnum:]]+',' ','g'))||' ',' '||t.token||' ')=0)
  ) SELECT bike_id,sum(points) points FROM matched GROUP BY bike_id`,
      [JSON.stringify(rules), JSON.stringify(site.catalog.componentGroups)],
    )
  ).rows;
  return new Map(rows.map((r) => [r.bike_id, Number(r.points)]));
}
export async function records(q: Queryable, context: GameContext = {}) {
  const settings = context.settings || (await getGameSettings(q));
  const rules = (context.rules || (await loadRules(q))).filter(
    (r) =>
      r.kind === "record" &&
      r.enabled &&
      metricByKey[r.metric] &&
      (settings.reactionsEnabled || !metricByKey[r.metric].reactions),
  );
  const site = context.site || (await getSite(q));
  const points = rules.some((r) => r.metric === "upgrade")
    ? await upgradePoints(q, site)
    : new Map<string, number>();
  const bikes = rules.some((r) => r.subject === "bike")
    ? (await q.query<LeaderboardBike>(leaderboardSQL)).rows.map((b) => ({
        ...b,
        upgrade: upgradeFromPoints(
          b,
          site.settings.scoring,
          points.get(b.id) || 0,
        ),
        completeness: bikeCompleteness(
          b.part_count,
          !!b.cover_id,
          site.settings.scoring,
        ),
      }))
    : [];
  const scopes = new Map<string, HolderResult>();
  const metricScopes = new Map<string, HolderPair>();
  const list: GameRecord[] = [];
  for (const rule of rules) {
    const key = JSON.stringify([
      rule.subject,
      rule.metric,
      rule.category,
      rule.subject === "ride" ? rule.minDistanceKm : null,
      rule.direction,
    ]);
    let result = scopes.get(key);
    if (!result) {
      if (rule.subject === "bike") result = bikeHolder(rule, bikes, settings);
      else {
        const scope = JSON.stringify([
          rule.subject,
          rule.metric,
          rule.category,
          rule.subject === "ride" ? rule.minDistanceKm : null,
        ]);
        let pair = metricScopes.get(scope);
        if (!pair) {
          pair = await metricHolders(q, rule);
          metricScopes.set(scope, pair);
        }
        result = pair[rule.direction === "min" ? "min" : "max"];
      }
      scopes.set(key, result);
    }
    list.push(recordDto(rule, result));
  }
  return { asOf: new Date().toISOString(), settings, records: list };
}

// Count and latest recipient share one visibility-filtered snapshot. No
// source ride is stored for a personal award, so never guess one from activity.
export async function awardCatalog(q: Queryable, context: GameContext = {}) {
  const recipients = new Map(
    (
      await q.query<{
        id: string;
        achievement_key: string;
        awarded_at: Date;
        owner_id: string;
        username: string;
        owner_name: string;
        avatar_id: string;
        bike_id: string;
        bike_share_id: string;
        bike_name: string;
        earners: number;
      }>(
        `WITH visible AS (
           SELECT a.id,a.achievement_key,a.awarded_at,a.user_id AS owner_id,
             u.username,u.name AS owner_name,u.avatar_id,
             b.id AS bike_id,b.share_id AS bike_share_id,b.name AS bike_name
           FROM achievement_awards a JOIN users u ON u.id=a.user_id
           LEFT JOIN bikes b ON b.id=a.bike_id
           WHERE NOT u.blocked AND (a.bike_id IS NULL OR (b.is_public AND b.owner_id=a.user_id))
         ), counts AS (
           SELECT achievement_key,count(DISTINCT owner_id)::int AS earners
           FROM visible GROUP BY achievement_key
         ), latest AS (
           SELECT DISTINCT ON (achievement_key) * FROM visible
           ORDER BY achievement_key,awarded_at DESC,id DESC
         )
         SELECT latest.*,counts.earners FROM latest JOIN counts USING(achievement_key)`,
      )
    ).rows.map((r) => [
      r.achievement_key,
      {
        earners: r.earners,
        latestRecipient: {
          awardedAt: r.awarded_at,
          author: author(r),
          bike: r.bike_id
            ? { id: r.bike_id, shareId: r.bike_share_id, name: r.bike_name }
            : null,
        },
      },
    ]),
  );
  return (context.rules || (await loadRules(q)))
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
      earners: recipients.get(r.key)?.earners || 0,
      latestRecipient: recipients.get(r.key)?.latestRecipient || null,
    }));
}

export async function awardShelf(
  q: Queryable,
  { userId = null, bikeId = null, privateView = false }: ShelfOptions = {},
) {
  const r = await q.query<{
    achievement_key: string;
    awarded_at: Date;
    bike_id: string;
    name: string;
    description: string;
    image_id: string;
    subject: string;
  }>(
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
export const holdsRecord = (
  record: GameRecord,
  { bikeId = null, userId = null }: ShelfOptions,
) =>
  !!record.holder &&
  (bikeId
    ? (record.holder.kind === "bike" && record.holder.id === bikeId) ||
      (record.holder.kind === "ride" && record.holder.bike.id === bikeId)
    : record.holder.author.id === userId);
export async function gameShelf(
  q: Queryable,
  options: ShelfOptions,
  context: GameContext = {},
) {
  const issued = await awardShelf(q, options),
    hall = await records(q, context);
  // A profile is a collection of earned rules. A bicycle still owns its own
  // award, even when another bicycle of the same rider earned the same rule.
  // Filter after visibility checks, by stable rule key (never by its title).
  const seen = new Set();
  const awards =
    options.userId && !options.bikeId
      ? issued.filter((award) => {
          if (seen.has(award.key)) return false;
          seen.add(award.key);
          return true;
        })
      : issued;
  return {
    awards,
    records: hall.records.filter((r) => holdsRecord(r, options)),
    asOf: hall.asOf,
  };
}
// Progress towards awards the person does not have yet: a person's metric,
// or the best of their public rides. A bike award has no single progress.
async function progress(q: Queryable, rule: GameRule, userId: string) {
  if (rule.subject === "user")
    return Number(
      (
        await q.query<{ value: string }>(
          "SELECT value FROM game_user_values($1,$2,$3)",
          [rule.metric, rule.category, userId],
        )
      ).rows[0]?.value || 0,
    );
  if (rule.subject === "ride") {
    const best = (
      await q.query<{ value: string }>(
        `SELECT ${rule.comparison === "lte" ? "min" : "max"}(value) AS value FROM game_ride_values($1,$2,$3,$4)`,
        [rule.metric, rule.category, rule.minDistanceKm, userId],
      )
    ).rows[0]?.value;
    return best == null ? 0 : Number(best);
  }
  return null;
}
export async function accountAchievements(q: Queryable, id: string) {
  const context = await gameContext(q);
  const shelf = await gameShelf(q, { userId: id, privateView: true }, context);
  const earned = new Set(shelf.awards.map((a) => a.key));
  const locked: {
    key: string;
    name: string;
    description: string;
    imageId: string | null;
    target: number | null;
    comparison: GameRule["comparison"];
    metric: string;
    progress: number | null;
  }[] = [];
  for (const rule of context.rules.filter(
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
        value === null || rule.threshold === null || rule.comparison === "lte"
          ? null
          : Math.min(rule.threshold, Math.round(value * 100) / 100),
    });
  }
  return { ...shelf, locked };
}
export async function reactionState(
  q: Queryable,
  bikeId: string,
  viewerId: string | undefined,
) {
  const b = (
    await q.query<{ owner_id: string }>(
      "SELECT b.owner_id FROM bikes b JOIN users u ON u.id=b.owner_id WHERE b.id=$1 AND b.is_public AND NOT u.blocked",
      [bikeId],
    )
  ).rows[0];
  if (!b) throw new CommunityError("Велосипед недоступен", 404);
  const settings = await getGameSettings(q);
  const result = await q.query<{
    kind: string;
    count: number;
    selected: boolean;
  }>(
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
export async function reactToBike(
  q: Queryable,
  bikeId: string,
  userId: string,
  kind: unknown,
  enabled: boolean,
) {
  const b = (
    await q.query<{ owner_id: string; is_public: boolean; blocked: boolean }>(
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
      await q.query<{ id: string }>(
        "SELECT id FROM users WHERE id=$1 AND NOT blocked",
        [userId],
      )
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

export async function excludeBike(
  q: Queryable,
  actor: string,
  bikeId: string,
  input: ExclusionInputType,
) {
  const r = await q.query<{ id: string }>(
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
export async function cardBadges(q: Queryable, ids: string[]) {
  const rows = (
    await q.query<{ bike_id: string; achievement_key: string; name: string }>(
      `SELECT a.bike_id,a.achievement_key,g.name FROM achievement_awards a JOIN game_rules g ON g.key=a.achievement_key AND g.enabled
       JOIN bikes b ON b.id=a.bike_id JOIN users u ON u.id=b.owner_id
       WHERE a.bike_id=ANY($1::uuid[]) AND b.is_public AND NOT u.blocked ORDER BY a.awarded_at DESC,a.id DESC`,
      [ids],
    )
  ).rows;
  const map = new Map<string, { key: string; name: string }[]>(
    ids.map((id: string) => [id, []]),
  );
  for (const a of rows) {
    const list = map.get(a.bike_id)!;
    if (list.length < 2) list.push({ key: a.achievement_key, name: a.name });
  }
  return map;
}
