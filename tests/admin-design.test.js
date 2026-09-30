import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  illustrationSlots,
  graphicAsset,
  filterGraphicSlots,
} from "../lib/design-graphics.ts";
import {
  siteAssetIds,
  siteAssetUsage,
  assetUsageLabels,
} from "../lib/site-assets.ts";
import {
  listAssetLibrary,
  deleteUnusedAssets,
} from "../lib/site-asset-library.ts";
import { settingsInput } from "../lib/admin-validation.ts";
import { componentIllustrationSlots } from "../lib/component-illustrations.ts";
import { defaultSettings } from "../lib/site-defaults.ts";

test("only content artwork is configurable and unknown appearance settings are rejected", () => {
  assert.equal(
    new Set(illustrationSlots.map((s) => s.key)).size,
    illustrationSlots.length,
  );
  assert.ok(
    filterGraphicSlots(illustrationSlots, "шоссе").some(
      (s) => s.key === "roadImageId",
    ),
  );
  assert.equal(
    graphicAsset(
      { faviconId: "image" },
      illustrationSlots.find((slot) => slot.key === "faviconId"),
    ),
    "image",
  );
  assert.equal(
    settingsInput.safeParse({ ...defaultSettings, uiIcons: { Bike: "old" } })
      .success,
    false,
  );
  assert.equal(
    settingsInput.safeParse({ ...defaultSettings, designPreset: "pixel-club" })
      .success,
    false,
  );
});
test("content, draft and award references remain protected; retired icon assignments are ignored", () => {
  assert.deepEqual(
    siteAssetIds({
      heroImageId: "b",
      faviconId: "a",
      uiIcons: { Bike: "unused" },
    }),
    ["a", "b"],
  );
  const usage = siteAssetUsage(
    { heroImageId: "same" },
    { recordImages: { light: "same" }, achievementImages: { dream: "same" } },
  );
  assert.deepEqual(usage.same, ["Оформление сайта", "Рекорды", "Достижения"]);
  assert.ok(
    assetUsageLabels({ id: "draft", usage: [] }, { heroImageId: "draft" }, {})
      .length,
  );
  assert.ok(
    assetUsageLabels(
      { id: "live", usage: [] },
      { heroImageId: null },
      { heroImageId: "live" },
    ).length,
  );
});

function fakeDatabase({ site = {}, game = {}, ids = [], afterLock } = {}) {
  const rows = new Map(
    ids.map((id) => [
      id,
      { id, name: id + ".webp", filename: "site-" + id + ".webp" },
    ]),
  );
  const calls = [];
  return {
    calls,
    rows,
    async query(sql, args) {
      calls.push({ sql, args });
      if (sql.includes("FOR UPDATE")) {
        if (afterLock) site = afterLock(site);
        return {
          rows: args[0].filter((id) => rows.has(id)).map((id) => ({ id })),
        };
      }
      if (sql.includes("FROM site_settings"))
        return { rows: [{ value: site }] };
      // Award and record illustrations live in their rules (#106).
      if (sql.includes("FROM game_rules"))
        return {
          rows: [
            ...Object.entries(game.recordImages || {}).map(
              ([key, image_id]) => ({ key, kind: "record", image_id }),
            ),
            ...Object.entries(game.achievementImages || {}).map(
              ([key, image_id]) => ({ key, kind: "award", image_id }),
            ),
          ],
        };
      if (sql.startsWith("DELETE")) {
        const deleted = args[0]
          .filter((id) => rows.has(id))
          .map((id) => rows.get(id));
        deleted.forEach((row) => rows.delete(row.id));
        return { rows: deleted };
      }
      if (sql.startsWith("SELECT id,name")) return { rows: [...rows.values()] };
      throw new Error("Unexpected SQL: " + sql);
    },
  };
}

test("library marks hero graphics and game illustrations as used", async () => {
  const q = fakeDatabase({
    ids: ["icon", "award", "unused"],
    site: { heroImageId: "icon" },
    game: { recordImages: { light: "award" } },
  });
  const rows = await listAssetLibrary(q);
  assert.ok(rows.find((r) => r.id === "icon").usage.length);
  assert.ok(rows.find((r) => r.id === "award").usage.length);
  assert.deepEqual(rows.find((r) => r.id === "unused").usage, []);
});

test("cleanup locks sorted explicit IDs then rechecks references before deletion", async () => {
  const q = fakeDatabase({
    ids: ["live", "part", "award", "unused", "unrequested"],
    site: { heroImageId: "live", mtbImageId: "part" },
    game: { achievementImages: { dream: "award" } },
  });
  const result = await deleteUnusedAssets(q, [
    "unused",
    "live",
    "award",
    "part",
    "missing",
    "unused",
  ]);
  assert.match(q.calls[0].sql, /ORDER BY id FOR UPDATE/);
  assert.deepEqual(q.calls[0].args[0], [
    "award",
    "live",
    "missing",
    "part",
    "unused",
  ]);
  assert.match(q.calls[1].sql, /site_settings/);
  assert.match(q.calls[2].sql, /game_rules/);
  assert.deepEqual(
    result.deleted.map((r) => r.id),
    ["unused"],
  );
  assert.deepEqual(result.skippedIds, ["award", "live", "missing", "part"]);
  assert.ok(q.rows.has("unrequested"));
});

test("an asset assigned after the list snapshot is skipped by cleanup", async () => {
  const q = fakeDatabase({
    ids: ["became-used"],
    afterLock: () => ({ heroImageId: "became-used" }),
  });
  const result = await deleteUnusedAssets(q, ["became-used"]);
  assert.deepEqual(result.deleted, []);
  assert.deepEqual(result.skippedIds, ["became-used"]);
  assert.equal(
    q.calls.some((call) => call.sql.startsWith("DELETE")),
    false,
  );
});

test("missing/empty asset sets never trigger an unrestricted DELETE", async () => {
  const q = fakeDatabase();
  assert.deepEqual((await deleteUnusedAssets(q, ["missing"])).deleted, []);
  assert.deepEqual((await deleteUnusedAssets(q, [])).deleted, []);
  assert.equal(
    q.calls.some((call) => call.sql.startsWith("DELETE")),
    false,
  );
});

test("cleanup route retains admin, Origin, UUID bounds, audit and post-commit file cleanup", () => {
  const route = readFileSync(
    new URL("../app/api/admin/assets/library/route.js", import.meta.url),
    "utf8",
  );
  assert.match(route, /user\.role !== "admin"/);
  assert.match(route, /!sameOrigin\(req\)/);
  assert.match(route, /input\.ids\.length > 500/);
  assert.match(route, /uuid\.safeParse\(id\)/);
  assert.match(route, /transaction\(async \(q\)/);
  assert.match(route, /audit\(q, user\.id, "asset\.delete"/);
  assert.ok(route.indexOf("await unlink") > route.indexOf("return deleted;"));
});

test("UUID case cannot make a referenced asset appear unused", async () => {
  const lower = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const upper = lower.toUpperCase();
  assert.deepEqual(siteAssetIds({ heroImageId: upper }), [lower]);
  const q = fakeDatabase({ ids: [lower], site: { heroImageId: upper } });
  const result = await deleteUnusedAssets(q, [upper, lower]);
  assert.deepEqual(result.deleted, []);
  assert.deepEqual(result.skippedIds, [lower]);
});

test("animation references protect both draft and saved files, independent of the global switch", () => {
  const saved = {
    heroAnimationsEnabled: false,
    heroStageAnimation: { kind: "rive", assetId: "a" },
  };
  const draft = {
    heroStageAnimation: null,
    heroTitleAnimation: { kind: "svg", assetId: "b" },
  };
  assert.deepEqual(siteAssetIds(saved), ["a"]);
  assert.deepEqual(siteAssetIds(draft), ["b"]);
  assert.ok(
    assetUsageLabels({ id: "a" }, draft, saved).includes("Опубликовано"),
  );
  assert.ok(
    assetUsageLabels({ id: "b" }, draft, saved).includes(
      "В настройках / черновике",
    ),
  );
  assert.deepEqual(siteAssetUsage(saved).a, ["Анимация главной"]);
});

test("shared motion and branding settings reject unsafe or unusable values", () => {
  assert.equal(
    settingsInput.parse({
      ...defaultSettings,
      autoScrollSpeed: 36,
      menuOpenOnHover: false,
    }).autoScrollSpeed,
    36,
  );
  for (const autoScrollSpeed of [0, -1, 81, 12.5, "24"])
    assert.equal(
      settingsInput.safeParse({ ...defaultSettings, autoScrollSpeed }).success,
      false,
    );
  for (const graphicsCreditsUrl of [
    "javascript:alert(1)",
    "//evil.test",
    "https://good.test/\\evil",
    "data:text/html,foo",
  ])
    assert.equal(
      settingsInput.safeParse({ ...defaultSettings, graphicsCreditsUrl })
        .success,
      false,
    );
  assert.equal(
    settingsInput.parse({
      ...defaultSettings,
      graphicsCreditsLabel: "Авторы",
      graphicsCreditsUrl: "/about",
    }).graphicsCreditsUrl,
    "/about",
  );
  assert.deepEqual(siteAssetIds({ brandLogoId: "logo" }), ["logo"]);
});

test("component artwork covers custom groups/types and protects published and draft references", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const slots = componentIllustrationSlots({
    componentGroups: [
      {
        id: "custom",
        name: "Особая группа",
        icon: "other",
        categories: ["Особая деталь"],
      },
    ],
    partCategories: { build: ["Новая деталь"], accessories: [] },
  });
  assert(slots.some((s) => s.kind === "groups" && s.name === "custom"));
  for (const name of ["Седло", "Особая деталь", "Новая деталь"])
    assert.equal(
      slots.filter((s) => s.kind === "categories" && s.name === name).length,
      1,
    );
  const settings = {
    ...defaultSettings,
    componentIllustrations: {
      groups: { custom: id },
      categories: { "Особая деталь": id },
    },
  };
  assert(settingsInput.safeParse(settings).success);
  assert.equal(
    graphicAsset(
      settings,
      slots.find((s) => s.name === "Особая деталь"),
    ),
    id,
  );
  assert.deepEqual(siteAssetIds(settings), [id]);
  assert.deepEqual(siteAssetUsage(settings)[id], ["Категории компонентов"]);
  assert(
    assetUsageLabels({ id }, settings, {}).includes("В настройках / черновике"),
  );
  const q = fakeDatabase({ site: settings, ids: [id] });
  assert.deepEqual((await deleteUnusedAssets(q, [id])).skippedIds, [id]);
  assert.equal(
    settingsInput.safeParse({
      ...settings,
      componentIllustrations: {
        categories: { Седло: "https://example.test/image.png" },
      },
    }).success,
    false,
  );
});
