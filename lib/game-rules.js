import { metricByKey } from "./game-metrics.js";
import { CommunityError } from "./community-validation.js";
import { audit } from "./site.js";
export { ruleInput, rulesInput } from "./game-rule-validation.js";

// Awards and records are rules in game_rules (#106): a metric from the
// catalog, a comparison and threshold (award) or a direction (record), and
// filters. Keys are permanent identities: award history refers to them.

/**
 * @typedef {{key:string,kind:'award'|'record',subject:'bike'|'ride'|'user',metric:string,comparison:'gte'|'lte',threshold:number|null,direction:'max'|'min'|null,category:string|null,minDistanceKm:number|null,keywords:string[],name:string,description:string,imageId:string|null,enabled:boolean,builtin:boolean,position:number}} GameRule
 */

/** @returns {GameRule} */
export function ruleDto(r) {
  return {
    key: r.key,
    kind: r.kind,
    subject: r.subject,
    metric: r.metric,
    comparison: r.comparison,
    threshold: r.threshold == null ? null : Number(r.threshold),
    direction: r.direction,
    category: r.category,
    minDistanceKm: r.min_distance_km == null ? null : Number(r.min_distance_km),
    keywords: r.keywords || [],
    name: r.name,
    description: r.description,
    imageId: r.image_id,
    enabled: r.enabled,
    builtin: r.builtin,
    position: r.position,
  };
}

/** @returns {Promise<GameRule[]>} */
export async function loadRules(q) {
  return (
    await q.query("SELECT * FROM game_rules ORDER BY kind,position,key")
  ).rows.map(ruleDto);
}

// The whole list at once, in its order. A built-in rule can be switched off
// but not deleted; a rule whose award somebody already has cannot be
// deleted either, so the history stays readable.
/** @param {import("zod").infer<typeof import("./game-rule-validation.js").rulesInput>} input */
export async function saveRules(q, actor, input) {
  const existing = new Map(
    (
      await q.query("SELECT * FROM game_rules ORDER BY key FOR UPDATE")
    ).rows.map((r) => [r.key, r]),
  );
  const kept = new Set(input.rules.map((r) => r.key));
  for (const rule of input.rules) {
    const prior = existing.get(rule.key);
    if (prior && prior.kind !== rule.kind)
      throw new CommunityError("Награду нельзя превратить в рекорд и наоборот");
  }
  const removed = [...existing.values()].filter((r) => !kept.has(r.key));
  if (removed.some((r) => r.builtin))
    throw new CommunityError(
      "Встроенные награды и рекорды нельзя удалить — их можно выключить",
    );
  if (removed.length) {
    const awarded = (
      await q.query(
        "SELECT DISTINCT achievement_key FROM achievement_awards WHERE achievement_key=ANY($1::text[])",
        [removed.map((r) => r.key)],
      )
    ).rows.map((r) => r.achievement_key);
    if (awarded.length)
      throw new CommunityError(
        "Награду уже получили, её можно только выключить: " +
          awarded.map((key) => "«" + existing.get(key).name + "»").join(", "),
        409,
      );
  }
  const images = [
    ...new Set(input.rules.map((r) => r.imageId).filter(Boolean)),
  ].sort();
  if (images.length) {
    // Asset deletion locks the same rows: an assigned file cannot disappear
    // between this check and the commit.
    const found = await q.query(
      "SELECT id FROM site_assets WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE",
      [images],
    );
    if (found.rows.length !== images.length)
      throw new CommunityError(
        "Иллюстрация удалена. Обновите медиатеку и выберите другую.",
        409,
      );
  }
  for (const [index, rule] of input.rules.entries())
    await q.query(
      `INSERT INTO game_rules(key,kind,subject,metric,comparison,threshold,direction,category,min_distance_km,keywords,name,description,image_id,enabled,position)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT(key) DO UPDATE SET subject=EXCLUDED.subject,metric=EXCLUDED.metric,comparison=EXCLUDED.comparison,
        threshold=EXCLUDED.threshold,direction=EXCLUDED.direction,category=EXCLUDED.category,
        min_distance_km=EXCLUDED.min_distance_km,keywords=EXCLUDED.keywords,name=EXCLUDED.name,
        description=EXCLUDED.description,image_id=EXCLUDED.image_id,enabled=EXCLUDED.enabled,
        position=EXCLUDED.position,updated_at=now()`,
      [
        rule.key,
        rule.kind,
        metricByKey[rule.metric].subject,
        rule.metric,
        rule.comparison,
        rule.kind === "award" ? rule.threshold : null,
        rule.kind === "record" ? rule.direction : null,
        rule.category,
        rule.minDistanceKm,
        rule.keywords,
        rule.name,
        rule.description,
        rule.imageId,
        rule.enabled,
        (index + 1) * 10,
      ],
    );
  if (removed.length)
    await q.query("DELETE FROM game_rules WHERE key=ANY($1::text[])", [
      removed.map((r) => r.key),
    ]);
  await audit(q, actor, "gamification.rules", String(input.rules.length));
  return loadRules(q);
}

// Awards are issued at the event (database triggers). After a new or
// changed rule, recalculation issues them for what people have already
// done. In batches: each person takes an advisory lock for the transaction.
export async function recalculateAwards(transaction, actor, batch = 200) {
  let after = null,
    awarded = 0;
  for (;;) {
    const result = await transaction(async (q) => {
      const users = (
        await q.query(
          "SELECT id FROM users WHERE NOT blocked AND ($1::uuid IS NULL OR id>$1) ORDER BY id LIMIT $2",
          [after, batch],
        )
      ).rows.map((r) => r.id);
      if (!users.length) return null;
      await q.query("SELECT cola_award_user(id) FROM unnest($1::uuid[]) id", [
        users,
      ]);
      // An award issued in this transaction carries its start time.
      const issued = (
        await q.query(
          "SELECT count(*)::int n FROM achievement_awards WHERE user_id=ANY($1::uuid[]) AND awarded_at=now()",
          [users],
        )
      ).rows[0].n;
      return { last: users.at(-1), awarded: issued };
    });
    if (!result) break;
    after = result.last;
    awarded += result.awarded;
  }
  await transaction((q) =>
    audit(q, actor, "gamification.recalculate", String(awarded)),
  );
  return { awarded };
}
