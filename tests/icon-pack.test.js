import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import { iconPack, iconPackNames, resolveIconAsset, mergeIconPack, withIconPack, bikeIconName } from "../lib/icon-pack.js";
import { uiIconNames } from "../lib/ui-icons.js";
import { siteAssetIds } from "../lib/site-assets.js";
import { readIconPack, readIconZipDirectory, crc32, ICON_ZIP_LIMIT } from "../lib/icon-pack-zip.js";
import { stageIconAssets } from "../lib/icon-pack-storage.js";

function zip(files, patch = () => {}) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, content, options = {}] of files) {
    const data = Buffer.from(content), filename = Buffer.from(name);
    const compressed = options.store ? data : deflateRawSync(data);
    const local = Buffer.alloc(30), central = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
    local.writeUInt16LE(options.flags || 0, 6); local.writeUInt16LE(options.store ? 0 : 8, 8);
    if (!(options.flags & 8)) {
      local.writeUInt32LE(crc32(data), 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(data.length, 22);
    }
    local.writeUInt16LE(filename.length, 26);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(0x0314, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(options.flags || 0, 8); central.writeUInt16LE(options.store ? 0 : 8, 10);
    central.writeUInt32LE(crc32(data), 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(filename.length, 28); central.writeUInt32LE((options.mode || 0) >>> 0, 38); central.writeUInt32LE(offset, 42);
    const descriptor = options.flags & 8 ? Buffer.alloc(16) : Buffer.alloc(0);
    if (descriptor.length) {
      descriptor.writeUInt32LE(0x08074b50, 0); descriptor.writeUInt32LE(crc32(data), 4);
      descriptor.writeUInt32LE(compressed.length, 8); descriptor.writeUInt32LE(data.length, 12);
    }
    patch(local, central);
    locals.push(local, filename, compressed, descriptor); centrals.push(central, filename);
    offset += local.length + filename.length + compressed.length + descriptor.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
const minimal = () => zip([["png/home_garage.png", "image"]]);

test("registry contains exactly the 64 requested distinct semantic names", () => {
  const expected = "home_garage profile admin messages logout search notifications add_bike journal rides about new popular following saved saved_active write_post comment reply share report edit delete draft private public resolved has_photos linked_ride linked_component post_upgrade post_service post_impression post_question post_story like subscriptions achievements records readers bookmark_alt bike_mtb bike_road_gravel bike_touring_commute bike_city bike_folding bike_fixed bike_electric similar_builds filter sort discover search_experience compare component bike_model settings categories image_gallery stats moderation pin visibility hide".split(" ");
  assert.deepEqual([...iconPackNames].sort(), expected.sort());
  assert.equal(new Set(uiIconNames).size, uiIconNames.length);
  for (const icon of iconPack) {
    assert.ok(uiIconNames.includes(icon.name)); assert.ok(icon.group && icon.label && icon.fallback);
  }
});
test("semantic precedence, independent states, null reset and legacy fallback", () => {
  const settings = { navMessagesIconId: "old-bell", uiIcons: { messages: "chat", notifications: "bell", saved: "empty", saved_active: "filled", popular: "fire", like: "heart", Search: "old-search" } };
  for (const key of ["messages", "notifications", "saved", "saved_active", "popular", "like"])
    assert.equal(resolveIconAsset(settings, key), settings.uiIcons[key]);
  assert.equal(resolveIconAsset(settings, "Search"), "old-search");
  assert.equal(resolveIconAsset({ navMessagesIconId: "old" }, "notifications"), "old");
  assert.equal(resolveIconAsset({ navMessagesIconId: "old", uiIcons: { notifications: null } }, "Bell"), null);
  assert.equal(resolveIconAsset({ uiIcons: { search: "new", Search: "old" } }, "Search"), "new");
});
test("partial replace and fill-empty keep unrelated settings and asset references", () => {
  const before = { logoId: "logo", uiIcons: { saved: "old", Menu: "menu" }, partIconAssets: { chain: "chain" } };
  const replaced = mergeIconPack(before, { saved: "fresh", saved_active: "filled" });
  assert.deepEqual(replaced, { saved: "fresh", saved_active: "filled", Menu: "menu" });
  assert.equal(before.uiIcons.saved, "old");
  assert.deepEqual(mergeIconPack(before, { saved: "fresh", like: "heart" }, "missing"), { saved: "old", Menu: "menu", like: "heart" });
  assert.throws(() => mergeIconPack(before, { unexpected: "id" }));
  assert.throws(() => mergeIconPack(before, {}, "erase"));
  assert.deepEqual(new Set(siteAssetIds({ ...before, uiIcons: replaced })), new Set(["logo", "fresh", "filled", "menu", "chain"]));
});
test("presentation adapter doesn't persist or alter banners, originals, or the messages slot", () => {
  const source = { logoId: "logo", faviconId: "fav", navMessagesIconId: "old", uiIcons: { notifications: "bell", messages: "chat", new: "new", popular: "pop", saved: "bookmark" } };
  const presented = withIconPack(source);
  assert.equal(presented.navMessagesIconId, "bell"); assert.equal(source.navMessagesIconId, "old");
  assert.equal(presented.logoId, "logo"); assert.equal(presented.faviconId, "fav");
  assert.equal(presented.navNewIconId, "new"); assert.equal(presented.navPopularIconId, "pop");
  assert.equal(withIconPack({ ...source, uiIcons: { notifications: null } }).navMessagesIconId, null);
});
test("category graphics support seven types without changing catalog data", () => {
  for (const [category, label, expected] of [["mtb", "MTB", "bike_mtb"], ["road", "Road / Gravel", "bike_road_gravel"], ["gravel", "Touring / Commute", "bike_touring_commute"], ["city", "Городской", "bike_city"], ["folding", "Складной", "bike_folding"], ["fixed", "Single speed", "bike_fixed"], ["electric", "E-bike", "bike_electric"]])
    assert.equal(bikeIconName(category, label), expected);
});
test("full delivery archive layout selects 64 PNG masters, ignores duplicates/previews/source", async () => {
  const files = iconPackNames.flatMap((name) => [
    ["bundle/png/" + name + ".png", "master"], ["bundle/svg/" + name + ".svg", "not executed"],
    ...[24, 32, 40, 256].map((size) => [`bundle/png-${size}/${name}.png`, "variant"]),
  ]);
  files.push(["bundle/index.html", "<script>never run</script>"], ["bundle/source/build.py", "not executed"], ["bundle/preview.png", "not an icon"], ["__MACOSX/._like.png", "ignored"]);
  const result = await readIconPack(zip(files));
  assert.equal(result.icons.length, 64); assert.equal(result.ignored.length, files.length - 64);
  assert.ok(result.icons.every((icon) => icon.bytes.toString() === "master"));
});
test("root files, wrapper, STORE, data descriptor and deterministic png/ priority", async () => {
  for (const options of [{}, { store: true }, { flags: 8 }]) {
    const result = await readIconPack(zip([["home_garage.png", "old", options], ["pack/png/home_garage.png", "master", options]]));
    assert.equal(result.icons[0].bytes.toString(), "master"); assert.equal(result.ignored.length, 1);
  }
});
for (const name of ["../like.png", "/like.png", "C:/like.png", "foo\\like.png", "foo/../like.png", "foo/./like.png", "foo//like.png", "bad\0like.png"])
  test("reject unsafe path " + JSON.stringify(name), async () => { await assert.rejects(readIconPack(zip([[name, "x"]])), /путь/); });
test("reject unknown-only or variant-only archives", async () => {
  await assert.rejects(readIconPack(zip([["preview.png", "x"]])), /нет известных/);
  await assert.rejects(readIconPack(zip([["png-256/like.png", "x"]])), /нет известных/);
});
test("reject ambiguous semantic masters and duplicate paths", async () => {
  await assert.rejects(readIconPack(zip([["a/png/like.png", "x"], ["b/png/like.png", "y"]])), /Несколько мастер/);
  await assert.rejects(readIconPack(zip([["png/like.png", "x"], ["png/LIKE.png", "y"]])), /Повторяющийся/);
});
test("reject encryption and symlinks even in ignored files", async () => {
  await assert.rejects(readIconPack(zip([["like.png", "x", { flags: 1 }]])), /Зашифрован/);
  await assert.rejects(readIconPack(zip([["source/tool", "x", { mode: 0xa0000000 }], ["like.png", "x"]])), /Ссылки/);
});
test("reject truncation, multidisk, ZIP64, unknown compression and oversized input", () => {
  assert.throws(() => readIconZipDirectory(minimal().subarray(0, -1)));
  let z = minimal(); z.writeUInt16LE(1, z.length - 18); assert.throws(() => readIconZipDirectory(z), /Многотом/);
  z = minimal(); z.writeUInt32LE(0xffffffff, z.length - 6); assert.throws(() => readIconZipDirectory(z), /ZIP64/);
  assert.throws(() => readIconZipDirectory(zip([["like.png", "x"]], (local, central) => central.writeUInt16LE(99, 10))), /Deflate/);
  assert.throws(() => readIconZipDirectory(Buffer.alloc(ICON_ZIP_LIMIT + 1)), /10 МБ/);
});
test("reject forged expansion limits before inflating", async () => {
  const tooBig = zip([["like.png", "x"]], (local, central) => { local.writeUInt32LE(33 * 1024 * 1024, 22); central.writeUInt32LE(33 * 1024 * 1024, 24); });
  await assert.rejects(readIconPack(tooBig), /32 МБ/);
  const bomb = zip([["like.png", "x".repeat(10000)]], (local, central) => { local.writeUInt32LE(1, 22); central.writeUInt32LE(1, 24); });
  await assert.rejects(readIconPack(bomb), /распаковать/);
});
test("reject local name mismatch, overlap and wrong CRC", async () => {
  let z = minimal(); z[30] = 88; await assert.rejects(readIconPack(z), /Имя файла/);
  const wrongCRC = zip([["like.png", "image"]], (local, central) => { local.writeUInt32LE(1, 14); central.writeUInt32LE(1, 16); });
  await assert.rejects(readIconPack(wrongCRC), /CRC/);
  const overlap = zip([["like.png", "image"], ["home.png", "xxx"]]);
  const centralStart = overlap.readUInt32LE(overlap.length - 6);
  overlap.writeUInt32LE(0, centralStart + 46 + Buffer.byteLength("like.png") + 42);
  await assert.rejects(readIconPack(overlap));
});
function storageHarness({ failWrite = 0, failDB = false } = {}) {
  const written = [], removed = [], queries = [];
  return {
    written, removed, queries,
    transaction: async (work) => work({ query: async (sql, values) => { queries.push({ sql, values }); if (failDB) throw Error("db failed"); } }),
    audit: async () => {}, dir: "/virtual/uploads",
    io: { mkdir: async () => {}, writeFile: async (name) => { written.push(name); if (written.length === failWrite) throw Error("disk failed"); }, unlink: async (name) => { removed.push(name); } },
  };
}
test("stage persists all references transactionally, never writes settings or deletes old assets", async () => {
  const harness = storageHarness();
  const result = await stageIconAssets([{ key: "like", bytes: Buffer.from("image") }, { key: "saved", bytes: Buffer.from("image") }], "admin", harness);
  assert.equal(result.assets.length, 2); assert.equal(harness.removed.length, 0);
  assert.ok(result.assignments.like); assert.ok(result.assignments.saved);
  assert.ok(harness.queries.every((q) => q.sql.startsWith("INSERT INTO site_assets")));
  assert.ok(harness.written.every((name) => /^\/virtual\/uploads\/site-[\da-f-]{36}\.webp$/.test(name)));
});
test("stage cleans files on partial write or transaction failure", async () => {
  for (const options of [{ failWrite: 2 }, { failDB: true }]) {
    const harness = storageHarness(options);
    await assert.rejects(stageIconAssets([{ key: "like", bytes: Buffer.from("a") }, { key: "saved", bytes: Buffer.from("b") }], "admin", harness));
    assert.deepEqual(harness.removed.sort(), harness.written.sort());
  }
});
test("a colliding exclusive write never removes an existing file", async () => {
  const h = storageHarness();
  h.io.writeFile = async () => { const e = Error("exists"); e.code = "EEXIST"; throw e; };
  await assert.rejects(stageIconAssets([{ key: "like", bytes: Buffer.from("a") }], "admin", h));
  assert.equal(h.removed.length, 0);
});
if (process.env.COLABIKE_ICON_ARCHIVE) test("actual supplied archive", async () => {
  const pack = await readIconPack(await readFile(process.env.COLABIKE_ICON_ARCHIVE));
  assert.deepEqual(pack.icons.map((i) => i.key).sort(), [...iconPackNames].sort());
  assert.ok(pack.icons.every((icon) => icon.filename.startsWith("png/")));
});
