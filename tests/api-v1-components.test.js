import test, { after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  componentCatalogFilters,
  componentModelCard,
  componentModelKeysetPage,
} from "../lib/component-catalog.ts";
import { componentPhotoList } from "../lib/component-photos.ts";
import { componentSocial } from "../lib/component-social.ts";
import { insertBike } from "../lib/repository.ts";
import { bikeInput } from "../lib/validation.ts";
import {
  decodeCursor,
  decodeRankCursor,
  encodeCursor,
  encodeRankCursor,
} from "../lib/api-v1/cursor.ts";
import {
  componentCatalogQuerySchema,
  componentModelSchema,
  componentPhotoSchema,
  parseComponentCatalogQuery,
} from "../lib/api-v1/schemas.ts";
import { toComponentModel, toComponentPhoto } from "../lib/api-v1/mappers.ts";

// API v1, the component catalog (#317): the list in two orders with a cursor,
// the card of a model (merged and archived ones), the public gallery and the
// comments through the shared engine. The server end to end is
// tests/api-v1-components-http.js.

const root = fileURLToPath(new URL("../", import.meta.url));
const db = new PGlite();
for (const file of (await readdir(path.join(root, "db")))
  .filter((name) => name.endsWith(".sql"))
  .sort())
  await db.exec(await readFile(path.join(root, "db", file), "utf8"));
after(() => db.close());

const run = randomUUID().slice(0, 6);
const stamp = (n, micro = 100) =>
  `2026-09-${String(n).padStart(2, "0")}T10:00:00.${String(micro).padStart(6, "0")}Z`;
async function addUser(label, blocked = false) {
  const id = randomUUID();
  await db.query(
    "INSERT INTO users(id,email,name,password_hash,username,blocked) VALUES($1,$2,$3,'hash',$4,$5)",
    [
      id,
      id + "@test.invalid",
      "Имя " + label,
      (label + "-" + id.slice(0, 8)).toLowerCase(),
      blocked,
    ],
  );
  return id;
}
async function addBike(owner, isPublic = true) {
  return insertBike(
    db,
    owner,
    bikeInput.parse({
      name: "Bike " + randomUUID().slice(0, 6),
      brand: "Cube",
      model: "Nuroad",
      year: 2024,
      category: "gravel",
      description: "",
      color: "",
      size: "",
      weight: null,
      is_public: isPublic,
    }),
  );
}
// Installing a part creates its catalog model by itself (the trigger), and
// a public bike publishes the model.
const install = (bike, name, category = "Рама") =>
  db.query(
    "INSERT INTO components(id,bike_id,section,category,name) VALUES($1,$2,'build',$3,$4)",
    [randomUUID(), bike, category, name],
  );
const modelId = async (name) =>
  (await db.query("SELECT id FROM component_models WHERE name=$1", [name]))
    .rows[0].id;
async function addPhoto(model, author, options = {}) {
  const id = randomUUID();
  await db.query(
    `INSERT INTO component_photos(id,model_id,author_id,filename,size_bytes,width,height,caption,sort_order,hidden,created_at,source)
     VALUES($1,$2,$3,$4,1000,800,600,$5,$6,$7,$8,$9)`,
    [
      id,
      model,
      author,
      id + ".webp",
      options.caption ?? "",
      options.order ?? 0,
      options.hidden ?? false,
      options.at ?? stamp(5),
      options.source ? JSON.stringify(options.source) : null,
    ],
  );
  return id;
}
const page = (extra = {}) =>
  componentModelKeysetPage(db, {
    q: "",
    category: "",
    brand: "",
    sort: "new",
    limit: 50,
    after: null,
    ...extra,
  });
const ids = (result) => result.rows.map((row) => row.id);

const owner = await addUser("owner");
const second = await addUser("second");
const barred = await addUser("barred", true);
const bikes = [
  await addBike(owner),
  await addBike(owner),
  await addBike(second),
];
const closedBike = await addBike(owner, false);
const barredBike = await addBike(barred);
const names = {
  popular: `Shimano Popular${run}`,
  middle: `SRAM Middle${run}`,
  rare: `Ritchey Rare${run}`,
  hiddenOnly: `Fizik Closed${run}`,
  archived: `Brooks Archive${run}`,
};
for (const bike of bikes) await install(bike, names.popular, "Тормоза");
await install(bikes[0], names.middle, "Тормоза");
await install(bikes[1], names.middle, "Тормоза");
await install(bikes[0], names.rare, "Руль");
await install(closedBike, names.hiddenOnly, "Седло");
await install(barredBike, names.popular, "Тормоза"); // does not count
await install(bikes[2], names.archived, "Седло");
const id = {
  popular: await modelId(names.popular),
  middle: await modelId(names.middle),
  rare: await modelId(names.rare),
  hiddenOnly: await modelId(names.hiddenOnly),
  archived: await modelId(names.archived),
};
await db.query("UPDATE component_models SET archived=true WHERE id=$1", [
  id.archived,
]);
for (const [key, n] of [
  ["popular", 3],
  ["middle", 4],
  ["rare", 5],
  ["archived", 6],
])
  await db.query("UPDATE component_models SET first_public_at=$2 WHERE id=$1", [
    id[key],
    stamp(n),
  ]);

test("the query schema and the two cursors", () => {
  const url = (query) => new URL("https://cola.example/x?" + query);
  const parsed = parseComponentCatalogQuery(
    url("sort=popular&brand=Shimano&limit=5"),
  );
  assert.equal(parsed.sort, "popular");
  assert.equal(parsed.limit, 5);
  assert.equal(parseComponentCatalogQuery(url("")).sort, "new");
  for (const bad of [
    "sort=best",
    "q=a&q=b",
    "page=2",
    "q=a%00b",
    "limit=0",
    "category=" + "x".repeat(61),
  ])
    assert.throws(
      () => parseComponentCatalogQuery(url(bad)),
      (e) => e.code === "invalid_request",
      bad,
    );
  assert.ok(componentCatalogQuerySchema);
  const point = { createdAt: stamp(3), id: randomUUID() };
  assert.deepEqual(decodeCursor(encodeCursor(point)), point);
  const rank = { rank: 7, id: randomUUID() };
  assert.deepEqual(decodeRankCursor(encodeRankCursor(rank)), rank);
  // One list's cursor is not the other's.
  assert.throws(
    () => decodeRankCursor(encodeCursor(point)),
    (e) => e.code === "invalid_request",
  );
  assert.throws(
    () => decodeCursor(encodeRankCursor(rank)),
    (e) => e.code === "invalid_request",
  );
  assert.throws(
    () => decodeRankCursor("junk"),
    (e) => e.code === "invalid_request",
  );
  assert.throws(
    () =>
      decodeRankCursor(
        Buffer.from(JSON.stringify({ n: -1, i: randomUUID() })).toString(
          "base64url",
        ),
      ),
    (e) => e.code === "invalid_request",
  );
});

test("the list shows published, unarchived, unmerged models; builds count public bikes of people who are not blocked", async () => {
  const listed = await page();
  const mine = listed.rows.filter((row) => Object.values(id).includes(row.id));
  assert.deepEqual(
    mine.map((row) => row.id),
    [id.rare, id.middle, id.popular],
    "newest first",
  );
  assert.equal(
    listed.rows.find((row) => row.id === id.popular).builds,
    3,
    "a private bike and a blocked owner do not count",
  );
  assert.ok(!ids(listed).includes(id.archived), "archived is not listed");
  assert.ok(
    !ids(listed).includes(id.hiddenOnly),
    "never public: not published",
  );
  const byText = await page({ q: "Middle" + run });
  assert.deepEqual(ids(byText), [id.middle]);
  assert.deepEqual(ids(await page({ category: "Руль", q: run })), [id.rare]);
  assert.deepEqual(ids(await page({ q: "нет-такого" + run })), []);
});

test("new: a cursor walk visits every model once, whatever is published meanwhile", async () => {
  const seen = [];
  let after = null;
  let fresh = null;
  for (let step = 0; step < 10; step++) {
    const result = await page({ q: run, limit: 1, after });
    seen.push(...ids(result));
    if (step === 0) {
      fresh = `Ritchey Fresh${run}`;
      await install(bikes[0], fresh, "Руль");
      await db.query(
        "UPDATE component_models SET first_public_at=$2 WHERE name=$1",
        [fresh, stamp(20)],
      );
    }
    if (!result.next) break;
    after = decodeCursor(encodeCursor(result.next));
  }
  assert.deepEqual(seen, [id.rare, id.middle, id.popular]);
  assert.ok(!seen.includes(await modelId(fresh)));
});

test("popular: by builds with the id as the tie-break; the cursor holds the count", async () => {
  const result = await page({ sort: "popular", q: run });
  const order = ids(result).filter((value) =>
    Object.values(id).includes(value),
  );
  assert.equal(order[0], id.popular, "three builds");
  assert.equal(order[1], id.middle, "two builds");
  assert.equal(order[2], id.rare, "one build");
  const seen = [];
  let after = null;
  for (let step = 0; step < 10; step++) {
    const next = await page({ sort: "popular", q: run, limit: 1, after });
    seen.push(...ids(next));
    if (next.next) assert.ok("rank" in next.next);
    if (!next.next) break;
    after = decodeRankCursor(encodeRankCursor(next.next));
  }
  assert.equal(
    new Set(seen).size,
    seen.length,
    "no repeats while counts are still",
  );
  assert.equal(
    seen.filter((value) => Object.values(id).includes(value)).length,
    3,
  );
  // Equal counts break by id.
  const tie = await page({ sort: "popular", q: "Archive" + run });
  assert.ok(!ids(tie).includes(id.archived));
});

test("filters list the categories and brands of listed models only", async () => {
  const filters = await componentCatalogFilters(db);
  assert.ok(
    filters.categories.includes("Тормоза") &&
      filters.categories.includes("Руль"),
  );
  assert.ok(
    !filters.categories.includes("Седло"),
    "archived and unpublished models add nothing",
  );
  assert.deepEqual(
    [...filters.brands].sort((a, b) => a.localeCompare(b, "ru")),
    filters.brands,
    "brands are ordered",
  );
});

test("the card: a merged id leads to the canonical model, an archived one reads, an unpublished one is not found", async () => {
  const merged = await modelId(names.rare);
  const into = await modelId(names.popular);
  await db.query("UPDATE component_models SET merged_into=$2 WHERE id=$1", [
    merged,
    into,
  ]);
  const viaOld = await componentModelCard(db, merged);
  assert.equal(viaOld.id, into, "the canonical id");
  assert.ok(
    !ids(await page()).includes(merged),
    "a merged model is not listed",
  );
  await db.query("UPDATE component_models SET merged_into=NULL WHERE id=$1", [
    merged,
  ]);
  const archived = await componentModelCard(db, id.archived);
  assert.equal(archived.archived, true);
  assert.equal(await componentModelCard(db, id.hiddenOnly), null);
  assert.equal(await componentModelCard(db, randomUUID()), null);
  assert.equal(await componentModelCard(db, "not-a-uuid"), null);
});

test("the DTO has the page's own fields and nothing about installations", async () => {
  const card = toComponentModel(await componentModelCard(db, id.popular));
  assert.deepEqual(componentModelSchema.parse(card), card);
  assert.equal(card.builds, 3);
  assert.equal(card.coverUrl, null);
  assert.match(card.path, /^\//);
  const keys = JSON.stringify(Object.keys(card));
  for (const hidden of [
    "owner",
    "bike",
    "install",
    "version",
    "merged",
    "user",
  ])
    assert.ok(!keys.toLowerCase().includes(hidden), hidden);
});

test("the gallery: cover first, hidden photos and blocked authors' photos out, the credit kept", async () => {
  const model = id.popular;
  const first = await addPhoto(model, owner, { order: 2, caption: "Первая" });
  const covered = await addPhoto(model, second, {
    order: 5,
    caption: "Обложка",
  });
  await db.query("UPDATE component_models SET cover_photo_id=$2 WHERE id=$1", [
    model,
    covered,
  ]);
  const hidden = await addPhoto(model, owner, { hidden: true });
  const byBlocked = await addPhoto(model, barred);
  const credited = await addPhoto(model, owner, {
    order: 9,
    source: {
      provider: "Wikimedia Commons",
      url: "https://commons.wikimedia.org/wiki/File:X.jpg",
      imageUrl: "https://upload.wikimedia.org/x.jpg",
      title: "File:X.jpg",
      creator: "Автор",
      credit: "Автор / CC BY-SA 4.0",
      license: "CC BY-SA 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    },
  });
  const gallery = await componentPhotoList(db, model);
  assert.deepEqual(
    gallery.rows.map((row) => row.id),
    [covered, first, credited],
  );
  assert.ok(!gallery.rows.some((row) => [hidden, byBlocked].includes(row.id)));
  const photos = gallery.rows.map((row, index) =>
    toComponentPhoto(row, index === 0),
  );
  for (const photo of photos)
    assert.deepEqual(componentPhotoSchema.parse(photo), photo);
  assert.equal(photos[0].isCover, true);
  assert.equal(photos[1].isCover, false);
  assert.equal(photos[2].source.license, "CC BY-SA 4.0");
  assert.ok(
    !("imageUrl" in photos[2].source),
    "the source's file address is internal",
  );
  assert.equal(photos[1].source, null);
  const keys = JSON.stringify(photos);
  for (const hiddenKey of [
    "hidden",
    "canEdit",
    "canReport",
    "version",
    "unavailable",
    "filename",
  ])
    assert.ok(!keys.includes(`"${hiddenKey}"`), hiddenKey);
  await assert.rejects(
    componentPhotoList(db, id.hiddenOnly),
    (e) => e.status === 404,
  );
});

test("comments of a model: the same Comment as everywhere, merged models together, hidden models a 404", async () => {
  const model = id.middle;
  const author = await addUser("commenter");
  const comment = async (target, text, options = {}) => {
    const commentId = randomUUID();
    await db.query(
      "INSERT INTO component_comments(id,model_id,author_id,parent_id,body,created_at,updated_at,deleted_at) VALUES($1,$2,$3,$4,$5,$6,$6,$7)",
      [
        commentId,
        target,
        options.author ?? author,
        options.parent ?? null,
        options.deleted ? "" : text,
        options.at ?? stamp(6),
        options.deleted ? stamp(7) : null,
      ],
    );
    return commentId;
  };
  const root = await comment(model, "Корень", { at: stamp(6) });
  await comment(model, "Ответ", { parent: root, at: stamp(7) });
  const gone = await comment(model, "", { deleted: true, at: stamp(8) });
  await comment(model, "Под удалённым", { parent: gone, at: stamp(9) });
  const result = await componentSocial.keysetPage(db, model, {
    limit: 10,
    cursor: null,
    focus: null,
  });
  assert.equal(result.roots.length, 2);
  assert.equal(result.roots[0].comment.body, "Корень");
  assert.equal(result.roots[0].replies.length, 1);
  assert.equal(
    result.roots[1].comment.deleted_at !== null ||
      result.roots[1].comment.body === "",
    true,
    "a tombstone while a reply is readable",
  );
  const replies = await componentSocial.keysetReplies(db, model, root, {
    limit: 10,
    cursor: null,
  });
  assert.equal(replies.replies.length, 1);
  // A model merged into this one: its comments show here too.
  const old = await modelId(names.rare);
  await comment(old, "Со старой модели", { at: stamp(10) });
  await db.query("UPDATE component_models SET merged_into=$2 WHERE id=$1", [
    old,
    model,
  ]);
  const merged = await componentSocial.keysetPage(db, model, {
    limit: 10,
    cursor: null,
    focus: null,
  });
  assert.ok(
    merged.roots.some((thread) => thread.comment.body === "Со старой модели"),
  );
  await db.query("UPDATE component_models SET merged_into=NULL WHERE id=$1", [
    old,
  ]);
  await assert.rejects(
    componentSocial.keysetPage(db, id.hiddenOnly, {
      limit: 10,
      cursor: null,
      focus: null,
    }),
    (e) => e.status === 404,
  );
});
