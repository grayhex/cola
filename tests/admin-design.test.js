import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { illustrationSlots, interfaceSlots, componentSlots, graphicAsset, filterGraphicSlots } from "../lib/design-graphics.js";
import { iconPack, semanticIconName, mergeIconPack } from "../lib/icon-pack.js";
import { legacyUiIconNames, uiIconLabels } from "../lib/ui-icons.js";
import { iconPaths } from "../lib/part-icons.js";
import { siteAssetIds, siteAssetUsage, assetUsageLabels } from "../lib/site-assets.js";
import { listAssetLibrary, deleteUnusedAssets } from "../lib/site-asset-library.js";

const slot = (key) => interfaceSlots.find((item) => item.key === key);

test("every semantic, legacy and component icon has exactly one effective editor", () => {
  assert.equal(new Set(interfaceSlots.map((s) => s.key)).size, interfaceSlots.length);
  for (const icon of iconPack) assert.equal(slot(icon.name)?.target, "semantic");
  for (const name of legacyUiIconNames) {
    assert.ok(uiIconLabels[name], "Russian label missing: " + name);
    assert.ok(slot(semanticIconName(name) || name), "Missing editor: " + name);
  }
  assert.deepEqual(componentSlots.map((s) => s.key).sort(), Object.keys(iconPaths).sort());
});

test("design and both journals are discoverable by their visible Russian names", () => {
  assert.ok(filterGraphicSlots(interfaceSlots, " ДИЗАЙН ").some((s) => s.key === "Palette"));
  const journals = filterGraphicSlots(interfaceSlots, "Журнал");
  assert.ok(journals.some((s) => s.key === "journal"));
  assert.ok(journals.some((s) => s.key === "History"));
  assert.equal(filterGraphicSlots(interfaceSlots, "неизвестный-слот").length, 0);
  assert.ok(filterGraphicSlots(interfaceSlots, "", "Администрирование").every((s) => s.group === "Администрирование"));
});

test("semantic editing shows the actual override, including explicit reset", () => {
  assert.equal(graphicAsset({ navJournalIconId: "old", uiIcons: { journal: "new" } }, slot("journal")), "new");
  assert.equal(graphicAsset({ navJournalIconId: "old", uiIcons: { journal: null } }, slot("journal")), null);
  assert.equal(graphicAsset({ navJournalIconId: "old" }, slot("journal")), "old");
  assert.equal(graphicAsset({ uiIcons: { Palette: "design" } }, slot("Palette")), "design");
  assert.equal(slot("navJournalIconId"), undefined, "Do not offer an ignored duplicate picker");
});

test("importing missing icons preserves chosen files and unrelated settings", () => {
  const settings = { navJournalIconId: "legacy", uiIcons: { Palette: "design", search: "chosen" } };
  const before = structuredClone(settings);
  const icons = mergeIconPack(settings, { journal: "incoming", saved: "saved", search: "incoming-search" }, "missing");
  assert.deepEqual(icons, { Palette: "design", search: "chosen", saved: "saved" });
  assert.deepEqual(settings, before);
});

test("all dedicated graphic IDs still have a semantic or illustration editor", () => {
  // This is the union of the old design page and About illustrations, including reserved history.
  const ids = ["logoId", "faviconId", "garageImageId", "backgroundImageId", "loginImageId", "registerImageId", "mtbImageId", "roadImageId", "gravelImageId", "demoImageId", "aboutGuideImageId", "aboutTechnologyImageId", "aboutHistoryImageId", "wizardLinkIconId", "wizardManualIconId", "navJournalIconId", "navNewIconId", "navPopularIconId", "navHomeIconId", "navRidesIconId", "navAboutIconId", "navProfileIconId", "navMessagesIconId", "navSubscriptionsIconId", "navRecordsIconId", "navAdminIconId", "navLogoutIconId", "addBikeIconId", "searchIconId", "likeIconId", "mtbTypeIconId", "roadTypeIconId", "gravelTypeIconId"];
  const covered = new Set([...illustrationSlots, ...interfaceSlots].flatMap((s) => [s.key, s.legacy]).filter(Boolean));
  for (const id of ids) assert.ok(covered.has(id), "Lost graphic slot: " + id);
});

test("site references include shadowed legacy assets and use deterministic lock order", () => {
  const settings = { logoId: "z", navJournalIconId: "old", uiIcons: { journal: "a", search: "z", Palette: null }, partIconAssets: { frame: "b" }, copy: { text: "not-an-asset" } };
  assert.deepEqual(siteAssetIds(settings), ["a", "b", "old", "z"]);
  assert.deepEqual(siteAssetIds(), []);
});

test("usage includes nested icons, parts, records and achievements without duplicates", () => {
  const usage = siteAssetUsage({ logoId: "same", uiIcons: { journal: "same", saved: "icon" }, partIconAssets: { frame: "part" } }, { recordImages: { light: "award" }, achievementImages: { dream: "award", unused: null } });
  assert.deepEqual(usage.same, ["Оформление сайта", "Иконки интерфейса"]);
  assert.deepEqual(usage.part, ["Иконки компонентов"]);
  assert.deepEqual(usage.award, ["Рекорды", "Достижения"]);
  assert.equal(usage.unused, undefined);
});

test("client protects unsaved assignments, live references and game images", () => {
  assert.ok(assetUsageLabels({ id: "draft", usage: [] }, { uiIcons: { journal: "draft" } }, {}).length);
  assert.ok(assetUsageLabels({ id: "live", usage: [] }, { logoId: null }, { logoId: "live" }).length);
  assert.ok(assetUsageLabels({ id: "award", usage: ["Достижения"] }, {}, {}).length);
  assert.deepEqual(assetUsageLabels({ id: "unused", usage: [] }, {}, {}), []);
});

function fakeDatabase({ site = {}, game = {}, ids = [], afterLock } = {}) {
  const rows = new Map(ids.map((id) => [id, { id, name: id + ".webp", filename: "site-" + id + ".webp" }]));
  const calls = [];
  return {
    calls, rows,
    async query(sql, args) {
      calls.push({ sql, args });
      if (sql.includes("FOR UPDATE")) {
        if (afterLock) site = afterLock(site);
        return { rows: args[0].filter((id) => rows.has(id)).map((id) => ({ id })) };
      }
      if (sql.includes("FROM site_settings")) return { rows: [{ value: site }] };
      if (sql.includes("FROM gamification_settings")) return { rows: [{ value: game }] };
      if (sql.startsWith("DELETE")) {
        const deleted = args[0].filter((id) => rows.has(id)).map((id) => rows.get(id));
        deleted.forEach((row) => rows.delete(row.id));
        return { rows: deleted };
      }
      if (sql.startsWith("SELECT id,name")) return { rows: [...rows.values()] };
      throw new Error("Unexpected SQL: " + sql);
    },
  };
}

test("library marks pack icons and game illustrations as used", async () => {
  const q = fakeDatabase({ ids: ["icon", "award", "unused"], site: { uiIcons: { journal: "icon" } }, game: { recordImages: { light: "award" } } });
  const rows = await listAssetLibrary(q);
  assert.ok(rows.find((r) => r.id === "icon").usage.length);
  assert.ok(rows.find((r) => r.id === "award").usage.length);
  assert.deepEqual(rows.find((r) => r.id === "unused").usage, []);
});

test("cleanup locks sorted explicit IDs then rechecks references before deletion", async () => {
  const q = fakeDatabase({ ids: ["live", "part", "award", "unused", "unrequested"], site: { logoId: "live", partIconAssets: { frame: "part" } }, game: { achievementImages: { dream: "award" } } });
  const result = await deleteUnusedAssets(q, ["unused", "live", "award", "part", "missing", "unused"]);
  assert.match(q.calls[0].sql, /ORDER BY id FOR UPDATE/);
  assert.deepEqual(q.calls[0].args[0], ["award", "live", "missing", "part", "unused"]);
  assert.match(q.calls[1].sql, /site_settings/);
  assert.match(q.calls[2].sql, /gamification_settings/);
  assert.deepEqual(result.deleted.map((r) => r.id), ["unused"]);
  assert.deepEqual(result.skippedIds, ["award", "live", "missing", "part"]);
  assert.ok(q.rows.has("unrequested"));
});

test("an asset assigned after the list snapshot is skipped by cleanup", async () => {
  const q = fakeDatabase({ ids: ["became-used"], afterLock: () => ({ uiIcons: { journal: "became-used" } }) });
  const result = await deleteUnusedAssets(q, ["became-used"]);
  assert.deepEqual(result.deleted, []);
  assert.deepEqual(result.skippedIds, ["became-used"]);
  assert.equal(q.calls.some((call) => call.sql.startsWith("DELETE")), false);
});

test("missing/empty asset sets never trigger an unrestricted DELETE", async () => {
  const q = fakeDatabase();
  assert.deepEqual((await deleteUnusedAssets(q, ["missing"])).deleted, []);
  assert.deepEqual((await deleteUnusedAssets(q, [])).deleted, []);
  assert.equal(q.calls.some((call) => call.sql.startsWith("DELETE")), false);
});

test("cleanup route retains admin, Origin, UUID bounds, audit and post-commit file cleanup", () => {
  const route = readFileSync(new URL("../app/api/admin/assets/library/route.js", import.meta.url), "utf8");
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
  assert.deepEqual(siteAssetIds({ logoId: upper }), [lower]);
  const q = fakeDatabase({ ids: [lower], site: { uiIcons: { journal: upper } } });
  const result = await deleteUnusedAssets(q, [upper, lower]);
  assert.deepEqual(result.deleted, []);
  assert.deepEqual(result.skippedIds, [lower]);
});
