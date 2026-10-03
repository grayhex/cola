import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import type { JournalRow } from "../lib/database-rows.ts";
import { componentHits } from "../lib/discovery.ts";
import {
  experienceBikeRefine,
  experienceJournalKeyset,
  experienceUserKeyset,
  searchInput,
} from "../lib/search.ts";
import { rideKeysetPage, upcomingKeysetPage } from "../lib/rides.ts";
import { visibleBikePage } from "../lib/showcase.ts";
import { decodeCursor, encodeCursor } from "../lib/api-v1/cursor.ts";
import {
  componentSearchQuerySchema,
  experienceQuerySchema,
  parseExperienceQuery,
  parseRidesQuery,
  parseUsersSearchQuery,
  usersSearchQuerySchema,
} from "../lib/api-v1/schemas.ts";
import { toJournalSummary } from "../lib/api-v1/mappers.ts";
import { testDatabase } from "./support/database.ts";
import { bikeThroughWriter, componentRow } from "./support/bikes.ts";
import { present } from "./support/assertions.ts";
import { journalEntryRow } from "./support/notifications.ts";
import { invalid } from "./support/negative.ts";
import { rideRow } from "./support/rides.ts";
import { labelledUser } from "./support/people.ts";

// API v1 search (#315): the experience search by keyset, people, component
// suggestions and the text of ride lists. The HTTP layer end to end is
// tests/api-v1-search-http.js.

const db = await testDatabase();
after(() => db.close());

const run = randomUUID().slice(0, 6);
const stamp = (n: number, micro = 100) =>
  `2026-09-${String(n).padStart(2, "0")}T10:00:00.${String(micro).padStart(6, "0")}Z`;
async function addUser(
  label: string,
  {
    blocked = false,
    name,
    at = stamp(1),
  }: { blocked?: boolean; name?: string; at?: string } = {},
) {
  return (
    await labelledUser(db, label, {
      blocked,
      created_at: at,
      ...(name === undefined ? {} : { name }),
    })
  ).id;
}
async function addBike(
  owner: string,
  {
    isPublic = true,
    brand = "Cube",
    model = "Nuroad",
    year = 2024,
    name,
    at,
  }: {
    isPublic?: boolean;
    brand?: string;
    model?: string;
    year?: number;
    name?: string;
    at?: string;
  } = {},
) {
  const id = await bikeThroughWriter(db, owner, {
    name: name ?? `${brand} ${model} ${randomUUID().slice(0, 4)}`,
    brand,
    model,
    year,
    is_public: isPublic,
  });
  if (at)
    await db.query("UPDATE bikes SET created_at=$2 WHERE id=$1", [id, at]);
  return id;
}
const addComponent = (bike: string, name: string, category = "Рама") =>
  componentRow(db, bike, { category, name });
async function addEntry(
  owner: string,
  bike: string,
  options: {
    status?: JournalRow["status"];
    isPublic?: boolean;
    kind?: JournalRow["kind"];
    at?: string;
    title?: string;
    body?: string;
    components?: JournalRow["components"];
  } = {},
) {
  const {
    status = "published",
    isPublic = true,
    kind = "build",
    at = stamp(2),
    title = "Запись",
    body = "Текст записи",
    components = [],
  } = options;
  return (
    await journalEntryRow(db, owner, bike, {
      kind,
      title,
      body,
      status,
      is_public: isPublic,
      mileage: 1200,
      components,
      created_at: at,
      updated_at: at,
      published_at: status === "published" ? at : null,
    })
  ).id;
}
const input = (extra: Partial<z.input<typeof searchInput>> = {}) =>
  searchInput.parse({ type: "bikes", ...extra });
type CursorOf = ReturnType<typeof decodeCursor> | null;
type RideQuery = Parameters<typeof rideKeysetPage>[2];
type BikeCursor = Parameters<typeof visibleBikePage>[2]["after"];
async function bikePage(
  viewer: string | null,
  extra: Partial<z.input<typeof searchInput>> = {},
  { limit = 50, after = null }: { limit?: number; after?: BikeCursor } = {},
) {
  return visibleBikePage(db, viewer, {
    scope: "public",
    categories: [],
    search: "",
    limit,
    after,
    refine: await experienceBikeRefine(db, input(extra)),
  });
}
const ids = (page: { bikes?: { id: string }[]; rows?: { id: string }[] }) =>
  present(page.bikes ?? page.rows).map((row) => row.id);

test("the query schema is the site's search without page and type, plus a cursor", () => {
  const legacy = Object.keys(searchInput.shape)
    .filter((key) => !["type", "page"].includes(key))
    .sort();
  const v1 = Object.keys(experienceQuerySchema.shape)
    .filter((key) => !["limit", "cursor"].includes(key))
    .sort();
  assert.deepEqual(v1, legacy, "a new facet of the site is a decision here");
});

test("query parsing: facets, unknown and repeated parameters, a text for people", () => {
  const url = (query: string) => new URL("https://cola.example/x?" + query);
  const parsed = parseExperienceQuery(
    url("q=cube&brand=Cube&year=2024&exact=1&limit=5"),
  );
  assert.equal(parsed.q, "cube");
  assert.equal(parsed.year, 2024);
  assert.equal(parsed.limit, 5);
  assert.equal(parseExperienceQuery(url("")).q, "");
  for (const bad of [
    "type=users",
    "page=2",
    "q=a&q=b",
    "year=20x4",
    "year=1800",
    "similar=not-a-uuid",
    "kind=poem",
    "q=" + "x".repeat(151),
    "q=a%00b",
    "electric=2",
    "limit=0",
  ])
    assert.throws(
      () => parseExperienceQuery(url(bad)),
      { code: "invalid_request" },
      bad,
    );
  assert.throws(
    () => parseUsersSearchQuery(url("")),
    { code: "invalid_request" },
    "a text is required",
  );
  assert.throws(() => parseUsersSearchQuery(url("q=%20%20")), {
    code: "invalid_request",
  });
  assert.equal(parseUsersSearchQuery(url("q=ив")).q, "ив");
  assert.equal(componentSearchQuerySchema.safeParse({}).success, false);
  assert.equal(componentSearchQuerySchema.parse({ q: "x" }).limit, 12);
  assert.equal(
    componentSearchQuerySchema.safeParse({ q: "x", limit: "25" }).success,
    false,
  );
  assert.equal(parseRidesQuery(url("q=%D0%BB%D0%B5%D1%81")).q, "лес");
  assert.equal(parseRidesQuery(url("")).q, "");
  assert.ok(usersSearchQuerySchema);
});

test("bikes: text, brand and model, year and component; hidden bikes are never found", async () => {
  const owner = await addUser("seller", { name: "Мастер Сборки" });
  const barred = await addUser("barred", { blocked: true });
  const tag = "Редкая" + run;
  const found = await addBike(owner, {
    brand: "Giant",
    model: "Defy" + run,
    year: 2022,
    name: tag + " шоссейник",
  });
  const other = await addBike(owner, {
    brand: "Cube",
    model: "Nuroad",
    year: 2024,
  });
  const closed = await addBike(owner, {
    brand: "Giant",
    model: "Defy" + run,
    isPublic: false,
  });
  const blockedBike = await addBike(barred, {
    brand: "Giant",
    model: "Defy" + run,
  });
  await addComponent(found, "Втулка Хаб" + run);
  for (const viewer of [null, owner]) {
    assert.deepEqual(ids(await bikePage(viewer, { q: tag })), [found]);
    assert.deepEqual(
      ids(await bikePage(viewer, { q: tag.toLowerCase() })),
      [found],
      "case",
    );
    assert.deepEqual(
      ids(await bikePage(viewer, { q: "хаб" + run })),
      [found],
      "by a component",
    );
    assert.deepEqual(
      ids(await bikePage(viewer, { brand: "giant", model: "defy" + run })),
      [found],
    );
    assert.deepEqual(
      ids(
        await bikePage(viewer, { brand: "Giant", model: "Defy", exact: "1" }),
      ),
      [],
      "exact model",
    );
    assert.deepEqual(
      ids(await bikePage(viewer, { year: "2022", q: "defy" + run })),
      [found],
    );
    assert.deepEqual(ids(await bikePage(viewer, { year: "1999", q: tag })), []);
    assert.deepEqual(
      ids(await bikePage(viewer, { component: "Втулка Хаб" + run })),
      [found],
    );
    for (const hidden of [closed, blockedBike])
      assert.ok(
        !ids(
          await bikePage(viewer, { brand: "Giant", model: "Defy" + run }),
        ).includes(hidden),
      );
  }
  assert.ok(
    ids(await bikePage(null)).includes(other),
    "an empty search lists like /bikes",
  );
});

test("bikes: similar to a bike, by its brand and model, not itself; a hidden one is a 404", async () => {
  const owner = await addUser("similar");
  const model = "Sim" + run;
  const origin = await addBike(owner, { brand: "Specialized", model });
  const twin = await addBike(owner, { brand: "Specialized", model });
  const stranger = await addBike(owner, { brand: "Trek", model: "Other" });
  const closed = await addBike(owner, {
    brand: "Specialized",
    model,
    isPublic: false,
  });
  const page = await bikePage(null, { similar: origin });
  assert.ok(ids(page).includes(twin));
  assert.ok(
    !ids(page).includes(origin) &&
      !ids(page).includes(stranger) &&
      !ids(page).includes(closed),
  );
  await assert.rejects(bikePage(null, { similar: closed }), { status: 404 });
  await assert.rejects(bikePage(null, { similar: randomUUID() }), {
    status: 404,
  });
});

test("bikes: keyset paging walks every match once, newest first, whatever is added meanwhile", async () => {
  const owner = await addUser("pager");
  const brand = "Pager" + run;
  const made = [];
  for (let i = 0; i < 5; i++)
    made.push(await addBike(owner, { brand, model: "M", at: stamp(10 + i) }));
  made.push(await addBike(owner, { brand, model: "M", at: stamp(14, 500000) }));
  const seen: string[] = [];
  let after: BikeCursor = null;
  let fresh = "";
  for (let step = 0; step < 10; step++) {
    const page = await bikePage(null, { brand }, { limit: 2, after });
    seen.push(...ids(page));
    if (step === 0)
      fresh = await addBike(owner, { brand, model: "M", at: stamp(20) });
    if (!page.next) break;
    after = decodeCursor(encodeCursor(page.next));
  }
  assert.equal(new Set(seen).size, seen.length);
  assert.ok(
    !seen.includes(fresh),
    "a bike added during the walk is before the cursor",
  );
  assert.deepEqual(seen, [
    made[5],
    made[4],
    made[3],
    made[2],
    made[1],
    made[0],
  ]);
});

test("journal: public published entries only, by text, kind and component snapshot; newest first with keyset", async () => {
  const owner = await addUser("writer");
  const barred = await addUser("barred2", { blocked: true });
  const bike = await addBike(owner, { brand: "Canyon", model: "Grail" });
  const closedBike = await addBike(owner, { isPublic: false });
  const barredBike = await addBike(barred);
  const word = "Тормоза" + run;
  const first = await addEntry(owner, bike, {
    title: word + " раз",
    at: stamp(3),
  });
  const second = await addEntry(owner, bike, {
    title: word + " два",
    kind: "service",
    at: stamp(4),
  });
  const third = await addEntry(owner, bike, {
    title: "Без слова",
    at: stamp(5),
    components: invalid<JournalRow["components"]>([
      { name: "Ротор" + run, category: "Тормоза" },
    ]),
  });
  const hidden = [
    await addEntry(owner, bike, {
      title: word,
      status: "draft",
      isPublic: false,
    }),
    await addEntry(owner, bike, { title: word, isPublic: false }),
    await addEntry(owner, closedBike, { title: word }),
    await addEntry(barred, barredBike, { title: word }),
  ];
  const search = (
    extra: Partial<z.input<typeof searchInput>>,
    options: { viewer?: string; limit?: number; after?: CursorOf } = {},
  ) =>
    experienceJournalKeyset(
      db,
      options.viewer ?? null,
      input({ type: "journal", ...extra }),
      options.limit ?? 50,
      options.after ?? null,
    );
  const all = await search({ q: word });
  assert.deepEqual(ids(all), [second, first], "newest first");
  for (const id of hidden) assert.ok(!ids(all).includes(id));
  assert.deepEqual(ids(await search({ q: word, kind: "service" })), [second]);
  assert.deepEqual(
    ids(await search({ component: "Ротор" + run })),
    [third],
    "by the installed snapshot",
  );
  const owned = await search({ q: word }, { viewer: owner });
  assert.deepEqual(
    ids(owned),
    [second, first],
    "a draft is not found even by its owner here",
  );
  // Paging one by one, with a new entry in between.
  const seen = [];
  let after = null;
  for (let step = 0; step < 6; step++) {
    const page = await search({ q: word }, { limit: 1, after });
    seen.push(...ids(page));
    if (step === 0)
      await addEntry(owner, bike, { title: word + " новая", at: stamp(9) });
    if (!page.next) break;
    after = decodeCursor(encodeCursor(page.next));
  }
  assert.deepEqual(seen, [second, first]);
  const card = toJournalSummary(all.rows[0], null);
  assert.equal(card.id, second);
  assert.equal(card.bike.id, bike);
  // A published entry with no date is kept by its creation.
  const dateless = await addEntry(owner, bike, {
    title: word + " без даты",
    at: stamp(1),
  });
  await db.query("UPDATE journal_entries SET published_at=NULL WHERE id=$1", [
    dateless,
  ]);
  assert.ok(ids(await search({ q: word })).includes(dateless));
});

test("people: by name or username, never blocked ones, newest accounts first, keyset", async () => {
  const mark = "Ivanov" + run;
  const a = await addUser("pa", { name: "Иван " + mark, at: stamp(2) });
  const b = await addUser("pb", { name: "Пётр " + mark, at: stamp(3) });
  const c = await addUser("pc", { name: "Анна " + mark, at: stamp(4) });
  const barred = await addUser("pd", {
    name: "Блок " + mark,
    blocked: true,
    at: stamp(5),
  });
  const viewer = await addUser("viewer");
  await db.query(
    "INSERT INTO user_follows(follower_id,following_id) VALUES($1,$2)",
    [viewer, b],
  );
  const search = (
    text: string,
    options: { viewer?: string; limit?: number; after?: CursorOf } = {},
  ) =>
    experienceUserKeyset(
      db,
      options.viewer ?? null,
      text,
      options.limit ?? 50,
      options.after ?? null,
    );
  const page = await search(mark.toLowerCase());
  assert.deepEqual(ids(page), [c, b, a]);
  assert.ok(!ids(page).includes(barred));
  assert.deepEqual(ids(await search("pb-")).slice(0, 1), [b], "by username");
  const seen: string[] = [];
  let after: CursorOf = null;
  for (let step = 0; step < 5; step++) {
    const next = await search(mark, { limit: 2, after });
    seen.push(...ids(next));
    if (!next.next) break;
    after = decodeCursor(encodeCursor(next.next));
  }
  assert.deepEqual(seen, [c, b, a]);
  const own = await search(mark, { viewer });
  assert.equal(
    present(own.rows.find((row) => row.id === b)).is_following,
    true,
  );
  assert.equal(
    present(own.rows.find((row) => row.id === a)).is_following,
    false,
  );
});

test("component suggestions: public bikes only, by popularity then name, a literal match", async () => {
  const owner = await addUser("parts");
  const barred = await addUser("parts-blocked", { blocked: true });
  const word = "Цепь" + run;
  const bikes = [
    await addBike(owner),
    await addBike(owner),
    await addBike(owner),
  ];
  const closed = await addBike(owner, { isPublic: false });
  const barredBike = await addBike(barred);
  await addComponent(bikes[0], word + " KMC");
  await addComponent(bikes[1], word.toLowerCase() + " kmc", "Цепи");
  await addComponent(bikes[2], word + " Shimano");
  await addComponent(closed, word + " Shimano");
  await addComponent(barredBike, word + " Shimano");
  await addComponent(bikes[0], "Совсем другое");
  const hits = await componentHits(db, word, 10);
  assert.equal(hits.length, 2, "forms of one name are one hit");
  assert.equal(hits[0].bikes, 2, "the more common first");
  assert.match(hits[0].name.toLowerCase(), /kmc/);
  assert.equal(
    hits[1].bikes,
    1,
    "bikes that are private or blocked do not count",
  );
  assert.equal((await componentHits(db, word, 1)).length, 1);
  assert.deepEqual(await componentHits(db, "нет такого" + run, 10), []);
  assert.deepEqual(Object.keys(hits[0]).sort(), ["bikes", "name"]);
});

test("rides: the text finds a title, a description, an author and a bike; the page rule holds", async () => {
  const owner = await addUser("rider", { name: "Райдер Лесной" });
  const bike = await addBike(owner, { name: "Серебряный" + run });
  const other = await addUser("rider2");
  const otherBike = await addBike(other);
  const add = async (
    author: string,
    withBike: string,
    title: string,
    description = "",
  ) =>
    (
      await rideRow(db, author, withBike, {
        title,
        description,
        distance_m: 1000,
        point_count: 0,
        public_point_count: 0,
        started_at: new Date(Date.now() - 2 * 86400000),
      })
    ).id;
  const byTitle = await add(other, otherBike, "Закат над озером" + run);
  const byDescription = await add(
    other,
    otherBike,
    "Утро",
    "Маршрут через сосновый бор" + run,
  );
  const byAuthor = await add(owner, bike, "Просто круг");
  const plain = await add(other, otherBike, "Ничего особенного");
  const search = async (text: string, options: Partial<RideQuery> = {}) =>
    ids(
      await rideKeysetPage(db, null, {
        limit: 50,
        after: null,
        text,
        ...options,
      }),
    );
  assert.deepEqual(await search("озером" + run), [byTitle]);
  assert.deepEqual(
    await search("СОСНОВЫЙ БОР" + run),
    [byDescription],
    "case insensitive",
  );
  assert.ok(
    (await search("лесной")).includes(byAuthor),
    "by the author's name",
  );
  assert.deepEqual(
    await search("серебряный" + run),
    [byAuthor],
    "by the bike's name",
  );
  assert.ok((await search("")).includes(plain), "no text lists everything");
  assert.deepEqual(await search("озером" + run, { bikeId: otherBike }), [
    byTitle,
  ]);
  assert.deepEqual(await search("озером" + run, { bikeId: bike }), []);
  // Planned rides take the text too.
  const plan = randomUUID();
  await db.query(
    `INSERT INTO rides(id,share_id,owner_id,bike_id,title,description,status,source_kind,has_track,distance_m,point_count,public_point_count,public_geometry,is_public,privacy_radius_m,source_hash,started_at)
     VALUES($1,$1,$2,$3,$4,'','planned','planned',false,0,0,0,'[]',true,500,$5,now()+interval '3 days')`,
    [plan, owner, bike, "Субботний заезд" + run, "p" + randomUUID()],
  );
  const upcoming = await upcomingKeysetPage(db, null, {
    limit: 50,
    after: null,
    text: "заезд" + run,
  });
  assert.deepEqual(ids(upcoming), [plan]);
  assert.deepEqual(
    ids(
      await upcomingKeysetPage(db, null, {
        limit: 50,
        after: null,
        text: "нет" + run,
      }),
    ),
    [],
  );
});
