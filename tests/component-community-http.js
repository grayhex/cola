import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import sharp from "sharp";
import { verifiedFetch } from "./fixtures/verified-user.js";
import { testConsents } from "./fixtures/legal.js";
const base = process.env.TEST_ORIGIN || "http://localhost:3100",
  nonce = randomUUID().slice(0, 8);
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
function client(verified = true) {
  let cookie = "";
  const request = async (path, method = "GET", data, headers = {}) => {
    const r = await (verified ? verifiedFetch : fetch)(base + "/api/" + path, {
      method,
      headers: {
        origin: base,
        cookie,
        "Content-Type": Buffer.isBuffer(data)
          ? "image/jpeg"
          : "application/json",
        ...headers,
      },
      body:
        data === undefined
          ? undefined
          : Buffer.isBuffer(data)
            ? data
            : JSON.stringify(data),
    });
    if (r.headers.get("set-cookie"))
      cookie = r.headers.get("set-cookie").split(";")[0];
    return { status: r.status, body: await r.json() };
  };
  request.raw = (path, headers = {}) =>
    fetch(base + path, { headers: { cookie, ...headers } });
  return request;
}
const owner = client(),
  stranger = client(),
  admin = client(),
  pending = client(false),
  guest = client();
const ids = [];
async function register(api, name) {
  const r = await api("auth/register", "POST", {
    ...testConsents,
    name,
    email: `component-${name}-${nonce}@example.test`,
    password: "component-http-secret-123",
  });
  assert.equal(r.status, 201, JSON.stringify(r));
  ids.push(r.body.user.id);
  return r.body.user.id;
}
const photo = await sharp({
  create: { width: 600, height: 900, channels: 3, background: "#c8792a" },
})
  .withMetadata({ exif: { IFD0: { Artist: "private-camera-owner" } } })
  .jpeg()
  .toBuffer();
const expectStatus = async (promise, status) => {
  const r = await promise;
  assert.equal(r.status, status, JSON.stringify(r));
  return r.body;
};
try {
  const ownerId = await register(owner, "owner"),
    strangerId = await register(stranger, "reader"),
    adminId = await register(admin, "admin"),
    pendingId = await register(pending, "pending");
  await db.query("UPDATE users SET role='admin' WHERE id=$1", [adminId]);
  const bikeInput = {
    name: "Private photo bike " + nonce,
    brand: "Cube",
    model: "Travel",
    year: 2024,
    category: "road",
    is_public: true,
    description: "",
    color: "",
    size: "",
    weight: null,
  };
  const b = await expectStatus(
    owner("bikes/wizard", "POST", {
      requestId: randomUUID(),
      bike: bikeInput,
      components: ["first", "second"].map((label) => ({
        section: "build",
        category: "Седло",
        name: "Brooks Community " + nonce + label,
        notes: "",
        price: null,
      })),
    }),
    201,
  );
  const parts = (
    await db.query(
      "SELECT id,model_id FROM components WHERE bike_id=$1 ORDER BY name",
      [b.id],
    )
  ).rows;
  const [model, second] = parts.map((p) => p.model_id);
  const photos = `components/${model}/photos`,
    comments = `components/${model}/comments`;
  await expectStatus(
    owner("bikes/" + b.id, "PATCH", { ...bikeInput, is_public: false }),
    200,
  );
  await expectStatus(guest(photos, "POST", photo), 401);
  await expectStatus(stranger(photos, "POST", photo), 403);
  await expectStatus(pending(photos, "POST", photo), 403);
  const policy = await expectStatus(
    pending(comments, "POST", { body: "Unverified" }),
    403,
  );
  assert.equal(policy.code, "EMAIL_VERIFICATION_REQUIRED");
  await expectStatus(
    owner(photos, "POST", photo, { origin: "https://evil.test" }),
    403,
  );
  await expectStatus(
    owner(photos, "POST", photo, { "Content-Type": "image/svg+xml" }),
    400,
  );
  await expectStatus(
    owner(photos, "POST", Buffer.from("<svg onload='alert(1)'/>")),
    400,
  );
  const small = await sharp({
    create: { width: 100, height: 100, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  await expectStatus(
    owner(photos, "POST", small, { "Content-Type": "image/png" }),
    400,
  );
  await expectStatus(
    owner(photos, "POST", Buffer.alloc(10 * 1024 * 1024 + 1)),
    413,
  );
  const first = await expectStatus(owner(photos, "POST", photo), 201);
  const cover = await expectStatus(admin(photos, "POST", photo), 201);
  const foreign = await expectStatus(
    admin(`components/${second}/photos`, "POST", photo),
    201,
  );
  let gallery = await expectStatus(guest(photos), 200);
  assert.equal(gallery.photos.length, 2);
  assert.equal(gallery.canUpload, false);
  assert.equal(gallery.photos[0].author.id, ownerId);
  assert.equal(JSON.stringify(gallery).includes(b.id), false);
  assert.equal(JSON.stringify(gallery).includes(bikeInput.name), false);
  assert.equal(JSON.stringify(gallery).includes("email"), false);
  assert.equal((await expectStatus(owner(photos), 200)).canUpload, true);
  const media = "/api/components/media/" + first.id;
  let response = await guest.raw(media + "?width=640");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-cache");
  assert.ok(response.headers.get("vary").split(/,\s*/).includes("Cookie"));
  const etag = response.headers.get("etag");
  const metadata = await sharp(
    Buffer.from(await response.arrayBuffer()),
  ).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.height, 640);
  assert.equal(metadata.exif, undefined);
  assert.equal(
    (await guest.raw(media + "?width=640", { "If-None-Match": etag })).status,
    304,
  );
  assert.equal((await guest.raw(media + "?width=641")).status, 400);
  await expectStatus(stranger(photos + "/" + first.id, "DELETE"), 403);
  await expectStatus(
    owner(photos + "/" + foreign.id, "PATCH", { version: 1, caption: "IDOR" }),
    404,
  );
  await expectStatus(
    owner(photos + "/" + first.id, "PATCH", { version: 1, hidden: true }),
    403,
  );
  await expectStatus(
    owner(photos + "/" + first.id, "PATCH", {
      version: 1,
      caption: "Публичное фото без раскрытия байка",
    }),
    200,
  );
  await expectStatus(
    owner(photos + "/" + first.id, "PATCH", { version: 1, caption: "stale" }),
    409,
  );
  gallery = await expectStatus(admin(photos), 200);
  await expectStatus(
    owner(photos, "PATCH", { version: gallery.version, coverId: first.id }),
    403,
  );
  await expectStatus(
    admin(photos, "PATCH", { version: gallery.version, coverId: foreign.id }),
    404,
  );
  await expectStatus(
    admin(photos, "PATCH", {
      version: gallery.version,
      coverId: cover.id,
      order: [cover.id, first.id],
    }),
    200,
  );
  assert.equal((await expectStatus(guest(photos), 200)).photos[0].id, cover.id);
  await expectStatus(
    admin(photos, "PATCH", { version: gallery.version, coverId: first.id }),
    409,
  );
  await expectStatus(
    stranger("community/reports", "POST", {
      entityType: "component_photo",
      targetId: first.id,
      reason: "copyright",
    }),
    200,
  );
  const reports = await expectStatus(admin("community/admin/reports"), 200);
  const report = reports.reports.find((r) => r.targetId === first.id);
  assert.ok(report);
  assert.ok(report.target.href.endsWith("#photo-" + first.id));
  await expectStatus(
    stranger("community/admin/reports/" + report.id, "PATCH", {
      action: "hide_component_photo",
    }),
    403,
  );
  await expectStatus(
    admin("community/admin/reports/" + report.id, "PATCH", {
      action: "hide_component_photo",
    }),
    200,
  );
  assert.equal(
    (await guest.raw(media + "?width=640", { "If-None-Match": etag })).status,
    404,
  );
  assert.equal((await owner.raw(media)).status, 200);
  await expectStatus(
    admin(photos + "/" + first.id, "PATCH", { version: 3, hidden: false }),
    200,
  );
  await db.query("UPDATE users SET blocked=true WHERE id=$1", [ownerId]);
  assert.equal((await guest.raw(media)).status, 404);
  await expectStatus(owner(photos, "POST", photo), 401);
  await expectStatus(owner(comments, "POST", { body: "blocked" }), 401);
  await db.query("UPDATE users SET blocked=false WHERE id=$1", [ownerId]);
  const root = await expectStatus(
    owner(comments, "POST", { body: "Вопрос про модель" }),
    201,
  );
  const reply = await expectStatus(
    stranger(comments, "POST", { parentId: root.id, body: "Опыт владельца" }),
    201,
  );
  await expectStatus(
    stranger(`components/${second}/comments`, "POST", {
      parentId: root.id,
      body: "Cross model",
    }),
    404,
  );
  await expectStatus(
    stranger(comments, "POST", { parentId: reply.id, body: "Too deep" }),
    400,
  );
  await expectStatus(
    stranger("components/comments/" + root.id, "PATCH", { body: "Not mine" }),
    403,
  );
  await expectStatus(
    stranger("components/comments/" + reply.id, "PATCH", {
      body: "Уточнённый опыт",
    }),
    200,
  );
  const thread = await expectStatus(
    guest(comments + "?focus=" + reply.id),
    200,
  );
  assert.equal(thread.comments[0].replies[0].body, "Уточнённый опыт");
  const notice = (
    await expectStatus(owner("community/notifications"), 200)
  ).notifications.find((n) => n.type === "component_reply");
  assert.ok(notice.target.href.includes(reply.id));
  await expectStatus(
    owner("community/reports", "POST", {
      entityType: "component_comment",
      targetId: reply.id,
      reason: "abuse",
    }),
    200,
  );
  const cr = (
    await expectStatus(admin("community/admin/reports"), 200)
  ).reports.find((r) => r.targetId === reply.id);
  await expectStatus(
    admin("community/admin/reports/" + cr.id, "PATCH", {
      action: "delete_comment",
    }),
    200,
  );
  assert.equal(
    (
      await expectStatus(owner("community/notifications"), 200)
    ).notifications.some((n) => n.type === "component_reply"),
    false,
  );
  // A concurrent upload pair competes for the final per-owner/model slot.
  const count = (
    await db.query(
      "SELECT count(*)::int n FROM component_photos WHERE model_id=$1 AND author_id=$2",
      [model, ownerId],
    )
  ).rows[0].n;
  for (let i = count; i < 11; i++)
    await expectStatus(owner(photos, "POST", photo), 201);
  const competing = await Promise.all([
    owner(photos, "POST", photo),
    owner(photos, "POST", photo),
  ]);
  assert.deepEqual(competing.map((r) => r.status).sort(), [201, 409]);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM component_photos WHERE model_id=$1 AND author_id=$2",
        [model, ownerId],
      )
    ).rows[0].n,
    12,
  );
  const [a, bModel] = (
    await db.query(
      "SELECT id,version FROM component_models WHERE id=ANY($1::uuid[]) ORDER BY id",
      [[model, second]],
    )
  ).rows;
  const currentVersion = (id) => [a, bModel].find((m) => m.id === id).version;
  await expectStatus(
    admin(`admin/component-models/${model}/merge`, "POST", {
      version: currentVersion(model),
      targetId: second,
      targetVersion: currentVersion(second),
    }),
    200,
  );
  const detail = (
    await db.query("SELECT * FROM component_models WHERE id=$1", [second])
  ).rows[0];
  await expectStatus(
    admin(`admin/component-models/${second}`, "PATCH", {
      version: detail.version,
      category: detail.category,
      name: "Renamed Photos " + nonce,
      brand: "Brooks",
      archived: false,
    }),
    200,
  );
  const after = await expectStatus(
    stranger(`components/${second}/comments`, "POST", {
      parentId: root.id,
      body: "После переименования",
    }),
    201,
  );
  assert.equal(
    (await expectStatus(guest(comments), 200)).comments[0].replies[0].id,
    after.id,
  );
  await expectStatus(owner("bikes/" + b.id, "DELETE"), 200);
  assert.equal((await expectStatus(guest(photos), 200)).photos.length, 14);
  assert.equal((await expectStatus(owner(photos), 200)).canUpload, false);
  await expectStatus(owner(photos, "POST", photo), 403);
  await db.query("UPDATE users SET email_verified_at=NULL WHERE id=$1", [
    ownerId,
  ]);
  await expectStatus(owner(photos + "/" + first.id, "DELETE"), 200);
  assert.equal((await guest.raw(media)).status, 404);
  await expectStatus(owner("components/comments/" + root.id, "DELETE"), 200);
  assert.equal(
    (await expectStatus(guest(comments), 200)).comments[0].unavailable,
    true,
  );
  assert.ok(
    (await expectStatus(owner("account/export", "POST"), 200)).componentPhotos
      .length,
  );
  await db.query("UPDATE users SET blocked=true WHERE id=$1", [strangerId]);
  assert.equal(
    (
      await expectStatus(owner("community/notifications"), 200)
    ).notifications.some((n) => n.type === "component_reply"),
    false,
  );
  assert.equal((await expectStatus(guest(comments), 200)).comments.length, 0);
  assert.ok(pendingId);
  console.log(
    "Component community HTTP: uploads/variants/metadata, private ownership, email/roles/Origin, IDOR, quota race, cover/order, moderation, shared comments/notifications, merge/rename and lifetime passed.",
  );
} finally {
  await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [ids]);
  await db.end();
}
