// API v1 search (#315), through the real server and PostgreSQL: experience
// search of bikes, journal and people, component suggestions, the text of ride
// lists; keyset paging, hidden objects, typed errors, Bearer, 405.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { testConsents } from "./fixtures/legal.js";
import { verifyCapturedEmail } from "./fixtures/verified-user.js";
import {
  bikePageSchema,
  errorSchema,
  journalPageSchema,
  ridePageSchema,
  userPageSchema,
  componentHitListSchema,
} from "../lib/api-v1/schemas.ts";

const base = process.env.TEST_ORIGIN || "http://localhost:3100";
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const run = randomUUID().replaceAll("-", "").slice(0, 8);
const password = "search-http-password-123";

async function http(path, { method = "GET", headers = {}, body, origin } = {}) {
  const response = await fetch(base + path, {
    method,
    redirect: "manual",
    headers: {
      ...(origin === undefined ? {} : { origin }),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return {
    status: response.status,
    body: json,
    text,
    headers: response.headers,
  };
}
async function member(label) {
  const email = `search-${label}-${run}@example.test`;
  let cookie = "";
  const web = async (path, method = "GET", body) => {
    const r = await http("/api" + path, {
      method,
      body,
      origin: base,
      headers: cookie ? { cookie } : {},
    });
    const set = r.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return r;
  };
  const registered = await web("/auth/register", "POST", {
    ...testConsents,
    name: `Поисковик${run} ${label}`,
    email,
    password,
  });
  assert.equal(registered.status, 201, registered.text);
  await verifyCapturedEmail(email);
  const v1 = (path, options = {}) =>
    http("/api/v1" + path, {
      ...options,
      headers: { cookie, ...(options.headers ?? {}) },
    });
  return { id: registered.body.user.id, web, v1 };
}
const guest = (path, options = {}) => http("/api/v1" + path, options);
const bikeBody = (name, brand, isPublic = true) => ({
  name,
  brand,
  model: "Модель" + run,
  year: 2024,
  category: "gravel",
  description: "",
  color: "",
  size: "",
  weight: null,
  is_public: isPublic,
});
function assertError(r, status, code, label) {
  assert.equal(r.status, status, label + " " + r.text);
  assert.deepEqual(errorSchema.parse(r.body), r.body, label);
  assert.equal(r.body.error.code, code, label);
}
const idsOf = (r) => r.body.items.map((item) => item.id);

try {
  const owner = await member("owner");
  const reader = await member("reader");
  const barred = await member("barred");
  const brand = "Бренд" + run;
  const publicA = (
    await owner.web("/bikes", "POST", bikeBody("Альфа " + run, brand))
  ).body.id;
  const publicB = (
    await owner.web("/bikes", "POST", bikeBody("Бета " + run, brand))
  ).body.id;
  const publicC = (
    await owner.web("/bikes", "POST", bikeBody("Гамма " + run, brand))
  ).body.id;
  const closed = (
    await owner.web("/bikes", "POST", bikeBody("Закрытый " + run, brand, false))
  ).body.id;
  const barredBike = (
    await barred.web("/bikes", "POST", bikeBody("Чужой " + run, brand))
  ).body.id;
  await db.query("UPDATE bikes SET created_at=$2 WHERE id=$1", [
    publicA,
    "2026-09-01T10:00:00.000001Z",
  ]);
  await db.query("UPDATE bikes SET created_at=$2 WHERE id=$1", [
    publicB,
    "2026-09-02T10:00:00.000001Z",
  ]);
  await db.query("UPDATE bikes SET created_at=$2 WHERE id=$1", [
    publicC,
    "2026-09-03T10:00:00.000001Z",
  ]);
  await db.query(
    "INSERT INTO components(id,bike_id,section,category,name) VALUES($1,$2,'build','Тормоза',$3)",
    [randomUUID(), publicA, "Суппорт" + run],
  );
  await db.query("UPDATE users SET blocked=true WHERE id=$1", [barred.id]);
  const entry = await owner.web("/journal", "POST", {
    bikeId: publicA,
    kind: "build",
    title: "Заметка" + run,
    body: "Текст про сборку",
    status: "published",
    isPublic: true,
    eventDate: "2026-08-30",
    mileage: 10,
    componentIds: [],
  });
  assert.equal(entry.status, 201, entry.text);
  const entryId = entry.body.id ?? entry.body.entry?.id;
  const draft = await owner.web("/journal", "POST", {
    bikeId: publicA,
    kind: "build",
    title: "Черновик" + run,
    body: "",
    status: "draft",
    isPublic: false,
    eventDate: "2026-08-30",
    mileage: 10,
    componentIds: [],
  });
  assert.equal(draft.status, 201, draft.text);

  // ── Bikes ─────────────────────────────────────────────────────────────
  for (const [label, ask] of [
    ["guest", guest],
    ["reader", reader.v1],
    ["owner", owner.v1],
  ]) {
    const list = await ask(
      "/experience/bikes?brand=" + encodeURIComponent(brand),
    );
    assert.equal(list.status, 200, list.text);
    assert.equal(list.headers.get("cache-control"), "no-store");
    assert.deepEqual(bikePageSchema.parse(list.body), list.body, label);
    assert.deepEqual(
      idsOf(list),
      [publicC, publicB, publicA],
      label + ": newest first",
    );
    assert.ok(
      !idsOf(list).includes(closed) && !idsOf(list).includes(barredBike),
      label,
    );
  }
  const byComponent = await guest(
    "/experience/bikes?component=" + encodeURIComponent("суппорт" + run),
  );
  assert.deepEqual(idsOf(byComponent), [publicA]);
  const byText = await guest(
    "/experience/bikes?q=" + encodeURIComponent("гамма " + run),
  );
  assert.deepEqual(idsOf(byText), [publicC]);
  const similar = await guest("/experience/bikes?similar=" + publicA);
  assert.ok(
    !idsOf(similar).includes(publicA) && idsOf(similar).includes(publicB),
  );
  assertError(
    await guest("/experience/bikes?similar=" + closed),
    404,
    "not_found",
    "similar private",
  );
  assertError(
    await guest("/experience/bikes?similar=" + randomUUID()),
    404,
    "not_found",
    "similar missing",
  );

  // keyset paging, one at a time
  const walked = [];
  let cursor = null;
  for (let step = 0; step < 6; step++) {
    const page = await guest(
      `/experience/bikes?brand=${encodeURIComponent(brand)}&limit=1${cursor ? "&cursor=" + cursor : ""}`,
    );
    walked.push(...idsOf(page));
    cursor = page.body.nextCursor;
    if (!cursor) break;
  }
  assert.deepEqual(walked, [publicC, publicB, publicA]);
  for (const [query, label] of [
    ["type=users", "type is the path"],
    ["page=2", "no pages"],
    ["q=a&q=b", "repeated"],
    ["year=abc", "bad year"],
    ["q=" + "x".repeat(151), "long text"],
    ["cursor=nonsense", "bad cursor"],
    ["limit=0", "limit"],
  ])
    assertError(
      await guest("/experience/bikes?" + query),
      400,
      "invalid_request",
      label,
    );

  // ── Journal ───────────────────────────────────────────────────────────
  for (const ask of [guest, reader.v1, owner.v1]) {
    const list = await ask(
      "/experience/journal?q=" + encodeURIComponent("заметка" + run),
    );
    assert.equal(list.status, 200, list.text);
    assert.deepEqual(journalPageSchema.parse(list.body), list.body);
    assert.deepEqual(
      idsOf(list),
      [entryId],
      "the draft is not found, not even by its owner",
    );
    assert.ok(!("body" in list.body.items[0]), "a card, not the entry");
  }
  assert.deepEqual(
    idsOf(await guest("/experience/journal?component=none" + run)),
    [],
  );

  // ── People ────────────────────────────────────────────────────────────
  const people = await reader.v1(
    "/experience/users?q=" + encodeURIComponent("Поисковик" + run),
  );
  assert.equal(people.status, 200, people.text);
  assert.deepEqual(userPageSchema.parse(people.body), people.body);
  assert.deepEqual(
    new Set(idsOf(people)),
    new Set([owner.id, reader.id]),
    "the blocked person is absent",
  );
  assert.ok(
    people.body.items.every((item) => item.relationship),
    "signed in: relationship",
  );
  assert.ok(
    (
      await guest(
        "/experience/users?q=" + encodeURIComponent("Поисковик" + run),
      )
    ).body.items.every((item) => item.relationship === null),
  );
  assertError(
    await guest("/experience/users"),
    400,
    "invalid_request",
    "a text is required",
  );
  assertError(
    await guest("/experience/users?q=a&brand=b"),
    400,
    "invalid_request",
    "facets are not people's",
  );
  assert.ok(!people.text.includes("@example.test"), "no e-mail");

  // ── Components ────────────────────────────────────────────────────────
  const hits = await guest(
    "/search/components?q=" + encodeURIComponent("суппорт" + run),
  );
  assert.equal(hits.status, 200, hits.text);
  assert.deepEqual(componentHitListSchema.parse(hits.body), hits.body);
  assert.deepEqual(hits.body.items, [{ name: "Суппорт" + run, bikes: 1 }]);
  assertError(
    await guest("/search/components"),
    400,
    "invalid_request",
    "text required",
  );
  assertError(
    await guest("/search/components?q=a&limit=99"),
    400,
    "invalid_request",
    "limit",
  );

  // ── The text of ride lists ────────────────────────────────────────────
  const ride = randomUUID();
  await db.query(
    `INSERT INTO rides(id,share_id,owner_id,bike_id,title,description,distance_m,point_count,public_point_count,public_geometry,is_public,privacy_radius_m,source_hash,started_at)
     VALUES($1,$1,$2,$3,$4,'',1000,0,0,'[]',true,500,$5,now()-interval '2 days')`,
    [ride, owner.id, publicA, "Рассвет" + run, "h" + run],
  );
  const rides = await guest("/rides?q=" + encodeURIComponent("рассвет" + run));
  assert.equal(rides.status, 200, rides.text);
  assert.deepEqual(ridePageSchema.parse(rides.body), rides.body);
  assert.deepEqual(idsOf(rides), [ride]);
  assert.deepEqual(
    idsOf(
      await guest(
        `/bikes/${publicA}/rides?q=${encodeURIComponent("рассвет" + run)}`,
      ),
    ),
    [ride],
  );
  assert.deepEqual(
    idsOf(
      await guest(
        `/bikes/${publicB}/rides?q=${encodeURIComponent("рассвет" + run)}`,
      ),
    ),
    [],
  );
  assertError(
    await guest("/rides?q=a%00b"),
    400,
    "invalid_request",
    "NUL in text",
  );

  // ── Transport ─────────────────────────────────────────────────────────
  for (const path of [
    "/experience/bikes",
    "/experience/journal",
    "/experience/users?q=a",
    "/search/components?q=a",
  ]) {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const r = await guest(path, { method, origin: base });
      assertError(r, 405, "method_not_allowed", method + " " + path);
    }
    assertError(
      await guest(path, {
        headers: { Authorization: "Bearer cola_at_" + "A".repeat(43) },
      }),
      401,
      "invalid_token",
      "bad Bearer " + path,
    );
  }
  // The legacy searches answer as before.
  const legacy = await http(
    "/api/search?q=" + encodeURIComponent("гамма " + run),
  );
  assert.equal(legacy.status, 200);
  assert.ok(
    "total" in legacy.body && "page" in legacy.body,
    "legacy keeps OFFSET paging",
  );

  console.log(
    "PASS: API v1 search: experience of bikes, journal and people, component suggestions, ride text, paging and hidden objects.",
  );
} finally {
  await db.end();
}
