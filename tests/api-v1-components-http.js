// API v1, the component catalog (#317), through the real server and PostgreSQL:
// the list in both orders and its cursors, filters, the card of a model
// (merged, archived, unpublished), the public gallery, comments, typed errors.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { testConsents } from "./fixtures/legal.js";
import { verifyCapturedEmail } from "./fixtures/verified-user.js";
import {
  commentPageSchema,
  componentFiltersSchema,
  componentModelPageSchema,
  componentModelSchema,
  componentPhotoListSchema,
  errorSchema,
  replyPageSchema,
} from "../lib/api-v1/schemas.ts";

const base = process.env.TEST_ORIGIN || "http://localhost:3100";
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const run = randomUUID().replaceAll("-", "").slice(0, 8);
const password = "components-http-password-123";

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
    name: "Райдер " + label,
    email: `components-${label}-${run}@example.test`,
    password,
  });
  assert.equal(registered.status, 201, registered.text);
  await verifyCapturedEmail(`components-${label}-${run}@example.test`);
  return { id: registered.body.user.id, web };
}
const guest = (path, options = {}) => http("/api/v1" + path, options);
const bikeBody = (name, isPublic = true) => ({
  name,
  brand: "Cube",
  model: "Nuroad",
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
const names = {
  popular: `Shimano Popular${run}`,
  middle: `SRAM Middle${run}`,
  rare: `Ritchey Rare${run}`,
  closed: `Fizik Closed${run}`,
  archived: `Brooks Archive${run}`,
};

try {
  const owner = await member("owner");
  const other = await member("other");
  const publicBikes = [];
  for (const label of ["a", "b", "c"])
    publicBikes.push(
      (
        await (label === "c" ? other : owner).web(
          "/bikes",
          "POST",
          bikeBody(`Велосипед ${label} ${run}`),
        )
      ).body.id,
    );
  const closedBike = (
    await owner.web("/bikes", "POST", bikeBody("Закрытый " + run, false))
  ).body.id;
  const install = (bike, name, category) =>
    db.query(
      "INSERT INTO components(id,bike_id,section,category,name) VALUES($1,$2,'build',$3,$4)",
      [randomUUID(), bike, category, name],
    );
  for (const bike of publicBikes) await install(bike, names.popular, "Тормоза");
  await install(publicBikes[0], names.middle, "Тормоза");
  await install(publicBikes[1], names.middle, "Тормоза");
  await install(publicBikes[0], names.rare, "Руль");
  await install(closedBike, names.closed, "Седло");
  await install(publicBikes[2], names.archived, "Седло");
  const modelOf = async (name) =>
    (await db.query("SELECT id FROM component_models WHERE name=$1", [name]))
      .rows[0].id;
  const id = {};
  for (const key of Object.keys(names)) id[key] = await modelOf(names[key]);
  await db.query("UPDATE component_models SET archived=true WHERE id=$1", [
    id.archived,
  ]);
  for (const [key, day] of [
    ["popular", 3],
    ["middle", 4],
    ["rare", 5],
    ["archived", 6],
  ])
    await db.query(
      "UPDATE component_models SET first_public_at=$2 WHERE id=$1",
      [id[key], `2026-09-0${day}T10:00:00.000100Z`],
    );

  // ── The list ──────────────────────────────────────────────────────────
  const listed = await guest(`/component-models?q=${run}`);
  assert.equal(listed.status, 200, listed.text);
  assert.equal(listed.headers.get("cache-control"), "no-store");
  assert.deepEqual(componentModelPageSchema.parse(listed.body), listed.body);
  assert.deepEqual(
    idsOf(listed),
    [id.rare, id.middle, id.popular],
    "newest first; archived and unpublished are not listed",
  );
  assert.equal(listed.body.items.find((m) => m.id === id.popular).builds, 3);
  assert.ok(!JSON.stringify(listed.body).includes("@example.test"));
  const popular = await guest(`/component-models?q=${run}&sort=popular`);
  assert.deepEqual(idsOf(popular), [id.popular, id.middle, id.rare]);
  assert.deepEqual(
    idsOf(
      await guest(
        `/component-models?q=${run}&category=${encodeURIComponent("Руль")}`,
      ),
    ),
    [id.rare],
  );

  for (const sort of ["new", "popular"]) {
    const walked = [];
    let cursor = null;
    for (let step = 0; step < 6; step++) {
      const next = await guest(
        `/component-models?q=${run}&sort=${sort}&limit=1${cursor ? "&cursor=" + cursor : ""}`,
      );
      assert.equal(next.status, 200, next.text);
      walked.push(...idsOf(next));
      cursor = next.body.nextCursor;
      if (!cursor) break;
    }
    assert.deepEqual(
      walked,
      sort === "new"
        ? [id.rare, id.middle, id.popular]
        : [id.popular, id.middle, id.rare],
      sort,
    );
  }
  // The cursor of one order is no cursor of the other.
  const newCursor = (await guest(`/component-models?q=${run}&limit=1`)).body
    .nextCursor;
  const popularCursor = (
    await guest(`/component-models?q=${run}&sort=popular&limit=1`)
  ).body.nextCursor;
  assertError(
    await guest(`/component-models?q=${run}&sort=popular&cursor=${newCursor}`),
    400,
    "invalid_request",
    "timestamp cursor on popular",
  );
  assertError(
    await guest(`/component-models?q=${run}&cursor=${popularCursor}`),
    400,
    "invalid_request",
    "rank cursor on new",
  );
  for (const query of ["sort=best", "page=2", "q=a&q=b", "limit=0"])
    assertError(
      await guest("/component-models?" + query),
      400,
      "invalid_request",
      query,
    );

  const filters = await guest("/component-models/filters");
  assert.equal(filters.status, 200, filters.text);
  assert.deepEqual(componentFiltersSchema.parse(filters.body), filters.body);
  assert.ok(filters.body.categories.includes("Тормоза"));

  // ── The card ──────────────────────────────────────────────────────────
  const card = await guest("/component-models/" + id.popular);
  assert.equal(card.status, 200, card.text);
  assert.deepEqual(componentModelSchema.parse(card.body), card.body);
  assert.equal(card.body.builds, 3);
  assert.equal(card.body.archived, false);
  assert.equal(
    (await guest("/component-models/" + id.archived)).body.archived,
    true,
    "an archived model reads",
  );
  assertError(
    await guest("/component-models/" + id.closed),
    404,
    "not_found",
    "never public",
  );
  assertError(
    await guest("/component-models/" + randomUUID()),
    404,
    "not_found",
    "unknown",
  );
  assertError(
    await guest("/component-models/not-a-uuid"),
    404,
    "not_found",
    "bad id",
  );
  // A merged model leads to the one it was merged into.
  await db.query("UPDATE component_models SET merged_into=$2 WHERE id=$1", [
    id.rare,
    id.popular,
  ]);
  assert.equal(
    (await guest("/component-models/" + id.rare)).body.id,
    id.popular,
  );
  assert.ok(
    !idsOf(await guest(`/component-models?q=${run}`)).includes(id.rare),
  );
  await db.query("UPDATE component_models SET merged_into=NULL WHERE id=$1", [
    id.rare,
  ]);

  // ── The gallery ───────────────────────────────────────────────────────
  const photo = async (author, options = {}) => {
    const photoId = randomUUID();
    await db.query(
      "INSERT INTO component_photos(id,model_id,author_id,filename,size_bytes,width,height,caption,sort_order,hidden) VALUES($1,$2,$3,$4,1000,800,600,$5,$6,$7)",
      [
        photoId,
        id.popular,
        author,
        photoId + ".webp",
        options.caption ?? "",
        options.order ?? 0,
        options.hidden ?? false,
      ],
    );
    return photoId;
  };
  const shown = await photo(owner.id, { caption: "Видно", order: 1 });
  const hidden = await photo(owner.id, { hidden: true });
  const gallery = await guest(`/component-models/${id.popular}/photos`);
  assert.equal(gallery.status, 200, gallery.text);
  assert.deepEqual(componentPhotoListSchema.parse(gallery.body), gallery.body);
  assert.deepEqual(idsOf(gallery), [shown]);
  assert.ok(!gallery.text.includes(hidden));
  assert.equal(gallery.body.items[0].isCover, true);
  assert.match(gallery.body.items[0].url, /^\/api\/components\/media\//);
  assertError(
    await guest(`/component-models/${id.closed}/photos`),
    404,
    "not_found",
    "photos of a hidden model",
  );
  // The cover shows in the list and the card.
  await db.query("UPDATE component_models SET cover_photo_id=$2 WHERE id=$1", [
    id.popular,
    shown,
  ]);
  assert.equal(
    (await guest("/component-models/" + id.popular)).body.coverUrl,
    "/api/components/media/" + shown,
  );

  // ── Comments ──────────────────────────────────────────────────────────
  const comment = async (
    text,
    parent = null,
    at = "2026-09-07T10:00:00.000100Z",
  ) => {
    const commentId = randomUUID();
    await db.query(
      "INSERT INTO component_comments(id,model_id,author_id,parent_id,body,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$6)",
      [commentId, id.popular, other.id, parent, text, at],
    );
    return commentId;
  };
  const root = await comment("Вопрос про тормоз");
  const replies = [];
  for (const [i, text] of ["раз", "два", "три", "четыре"].entries())
    replies.push(await comment(text, root, `2026-09-08T10:00:0${i}.000100Z`));
  const comments = await guest(`/component-models/${id.popular}/comments`);
  assert.equal(comments.status, 200, comments.text);
  assert.deepEqual(commentPageSchema.parse(comments.body), comments.body);
  assert.equal(comments.body.items[0].comment.body, "Вопрос про тормоз");
  assert.equal(comments.body.items[0].comment.replyCount, 4);
  assert.equal(comments.body.items[0].replies.length, 3);
  const more = await guest(
    `/component-models/${id.popular}/comments/${root}/replies`,
  );
  assert.deepEqual(replyPageSchema.parse(more.body), more.body);
  assert.equal(more.body.items.length, 4);
  const focus = await guest(
    `/component-models/${id.popular}/comments?focus=${replies[3]}`,
  );
  assert.equal(focus.body.focusPath.length, 2);
  assertError(
    await guest(`/component-models/${id.closed}/comments`),
    404,
    "not_found",
    "comments of a hidden model",
  );
  assertError(
    await guest(
      `/component-models/${id.popular}/comments?focus=${randomUUID()}`,
    ),
    404,
    "not_found",
    "unknown focus",
  );

  // ── Transport, legacy ─────────────────────────────────────────────────
  for (const path of [
    "/component-models",
    "/component-models/filters",
    `/component-models/${id.popular}`,
    `/component-models/${id.popular}/photos`,
    `/component-models/${id.popular}/comments`,
  ]) {
    // A comment collection takes POST since W1 (#330): its own tests.
    for (const method of /\/comments$/.test(path)
      ? ["PUT", "PATCH", "DELETE"]
      : ["POST", "PUT", "PATCH", "DELETE"])
      assertError(
        await guest(path, { method, origin: base }),
        405,
        "method_not_allowed",
        method + " " + path,
      );
    assertError(
      await guest(path, {
        headers: { Authorization: "Bearer cola_at_" + "A".repeat(43) },
      }),
      401,
      "invalid_token",
      "bad Bearer " + path,
    );
  }
  const legacy = await http(`/api/components?q=${run}`);
  assert.equal(legacy.status, 200);
  assert.ok(
    "total" in legacy.body && "page" in legacy.body,
    "legacy keeps OFFSET paging",
  );

  console.log(
    "PASS: API v1 components: list in two orders with cursors, filters, card, gallery, comments, hidden and merged models and legacy unchanged.",
  );
} finally {
  await db.end();
}
