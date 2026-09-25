import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Invoked by the isolated gamification HTTP drill, not production (#106):
// awards and records as rules, their words and illustrations, recalculation.
const inputFields = [
  "key",
  "kind",
  "metric",
  "comparison",
  "threshold",
  "direction",
  "category",
  "minDistanceKm",
  "keywords",
  "name",
  "description",
  "imageId",
  "enabled",
];
const input = (rule) =>
  Object.fromEntries(inputFields.map((field) => [field, rule[field]]));
export async function exerciseGameRules(admin, guest, regular, q) {
  const original = (await admin("game/admin/rules")).body.rules;
  const imageId = randomUUID();
  const custom = [
    {
      key: "rule_http_showcase",
      kind: "award",
      metric: "public_bikes",
      comparison: "gte",
      threshold: 1,
      name: "Витрина HTTP",
      description: "Первый публичный велосипед, заново.",
      imageId: null,
      enabled: true,
    },
    {
      key: "rule_http_light",
      kind: "record",
      metric: "weight",
      direction: "min",
      category: "road",
      name: "Пушинка HTTP",
      enabled: true,
    },
  ];
  try {
    await q.query(
      "INSERT INTO site_assets(id,name,filename) VALUES($1,$2,$3)",
      [imageId, "Game rules HTTP fixture", "site-" + imageId + ".webp"],
    );
    assert.equal((await guest("game/admin/rules")).status, 401);
    assert.equal((await regular("game/admin/rules")).status, 403);
    const list = original.map(input);
    const withArt = list.map((rule) =>
      ["expensive", "first_public", "full_build"].includes(rule.key)
        ? { ...rule, imageId, description: "Описание: " + rule.name }
        : rule,
    );
    const body = { rules: [...withArt, ...custom] };
    assert.equal((await guest("game/admin/rules", "PUT", body)).status, 401);
    assert.equal((await regular("game/admin/rules", "PUT", body)).status, 403);
    assert.equal(
      (await admin("game/admin/rules", "PUT", body, "https://evil.test"))
        .status,
      403,
    );
    // A price award is not in the catalog; the message names the rule.
    const priceAward = await admin("game/admin/rules", "PUT", {
      rules: [...list, { ...custom[0], metric: "price" }],
    });
    assert.equal(priceAward.status, 400);
    assert.match(
      priceAward.body.error,
      /«Витрина HTTP»: Эта метрика не подходит для награды/,
    );
    assert.equal(
      (
        await admin("game/admin/rules", "PUT", {
          rules: [...list, { ...custom[0], sql: "DROP TABLE users" }],
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await admin("game/admin/rules", "PUT", {
          rules: [...list, { ...custom[0], imageId: randomUUID() }],
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await admin("game/admin/rules", "PUT", {
          rules: list.filter((rule) => rule.key !== "marathon"),
        })
      ).status,
      400,
    );
    // Every rule with the longest multi-byte description fits the request.
    const long = {
      rules: [...list, ...custom].map((rule) => ({
        ...rule,
        description: "漢".repeat(160),
      })),
    };
    assert.ok(Buffer.byteLength(JSON.stringify(long)) > 8192);
    assert.equal((await admin("game/admin/rules", "PUT", long)).status, 200);
    const saved = await admin("game/admin/rules", "PUT", body);
    assert.equal(saved.status, 200);
    assert.equal(
      saved.body.rules.find((r) => r.key === "rule_http_light").subject,
      "bike",
    );
    assert.equal(
      (
        await q.query(
          "SELECT count(*)::int AS n FROM achievement_awards WHERE achievement_key='rule_http_showcase'",
        )
      ).rows[0].n,
      0,
    );
    const recalculated = await admin("game/admin/recalculate", "POST");
    assert.equal(recalculated.status, 200);
    assert.ok(recalculated.body.awarded >= 1);
    assert.equal((await regular("game/admin/recalculate", "POST")).status, 403);
    const hall = (await guest("game/records")).body;
    const expensive = hall.records.find((r) => r.key === "expensive");
    assert.equal(expensive.imageId, imageId);
    assert.equal(expensive.description, "Описание: " + expensive.name);
    const light = hall.records.find((r) => r.key === "rule_http_light");
    assert.equal(light.name, "Пушинка HTTP");
    // Held by a road bike of the rating, or free while none qualifies.
    assert.ok(light.holder === null || light.holder.kind === "bike");
    const showcase = hall.awards.find((a) => a.key === "rule_http_showcase");
    assert.ok(showcase.earners >= 1);
    assert.equal(
      hall.awards.find((a) => a.key === "first_public").imageId,
      imageId,
    );
    const shelf = (await regular("game/me")).body;
    assert.equal(
      shelf.awards.find((a) => a.key === "first_public")?.imageId,
      imageId,
    );
    assert.ok(shelf.awards.some((a) => a.key === "rule_http_showcase"));
    const locked = shelf.locked.find((a) => a.key === "full_build");
    assert.equal(locked?.imageId, imageId);
    assert.equal(locked?.description, "Описание: " + locked?.name);
    // An illustration in use cannot leave the media library.
    assert.equal(
      (await admin("admin/assets/" + imageId, "DELETE")).status,
      409,
    );
    // An earned award stays: the rule can only be switched off.
    const withoutCustom = await admin("game/admin/rules", "PUT", {
      rules: withArt,
    });
    assert.equal(withoutCustom.status, 409);
    assert.match(withoutCustom.body.error, /«Витрина HTTP»/);
    const off = await admin("game/admin/rules", "PUT", {
      rules: [...list, { ...custom[0], enabled: false }, custom[1]],
    });
    assert.equal(off.status, 200);
    assert.ok(
      off.body.rules.find((r) => r.key === "rule_http_showcase").awarded >= 1,
    );
    const hidden = (await guest("game/records")).body;
    assert.ok(!hidden.awards.some((a) => a.key === "rule_http_showcase"));
    assert.ok(
      !(await regular("game/me")).body.awards.some(
        (a) => a.key === "rule_http_showcase",
      ),
    );
    assert.equal(
      (await admin("admin/assets/" + imageId, "DELETE")).status,
      200,
    );
  } finally {
    await q.query(
      "DELETE FROM achievement_awards WHERE achievement_key LIKE 'rule_http_%'",
    );
    await q.query("DELETE FROM game_rules WHERE key LIKE 'rule_http_%'");
    await admin("game/admin/rules", "PUT", { rules: original.map(input) });
    await q.query("UPDATE game_rules SET image_id=NULL WHERE image_id=$1", [
      imageId,
    ]);
    await q.query("DELETE FROM site_assets WHERE id=$1", [imageId]);
  }
}
