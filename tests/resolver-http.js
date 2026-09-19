// Requires disposable test DB + tests/fixture-server.ts; never run against production.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
const base = process.env.TEST_ORIGIN || "http://localhost:3000";
let cookie = "";
async function api(path, method = "GET", data, origin = base) {
  const r = await fetch(base + "/api/" + path, {
    method,
    headers: { origin, cookie, "Content-Type": "application/json" },
    body: data ? JSON.stringify(data) : undefined,
  });
  if (r.headers.get("set-cookie"))
    cookie = r.headers.get("set-cookie").split(";")[0];
  return { status: r.status, data: await r.json() };
}
const q = { brand: "Giant", model: "Contend", trim: "AR 1", year: 2024 };
const email = "resolver-" + randomUUID() + "@example.test";
assert.equal((await api("admin/resolver")).status, 401);
const user = (
  await api("auth/register", "POST", {
    email,
    name: "Resolver test",
    password: "colabike-test-12345",
  })
).data.user;
assert.equal((await api("admin/resolver")).status, 403);
assert.equal((await api("admin/resolver/diagnostics")).status, 403);
assert.equal((await api("admin/resolver/inspect", "POST", q)).status, 403);
async function stream(path, input = q, origin = base) {
  const r = await fetch(base + "/api/" + path, {
    method: "POST",
    headers: { origin, cookie, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const text = await r.text();
  return {
    status: r.status,
    items: r.ok
      ? text
          .trim()
          .split("\n")
          .map((s) => JSON.parse(s))
      : [],
  };
}
assert.equal(
  (await stream("bikes/resolve-stream", q, "https://evil.example")).status,
  403,
);
const live = await stream("bikes/resolve-stream");
assert.equal(live.status, 200);
assert(live.items.some((e) => e.event === "components_recognized"));
const streamed = live.items.at(-1).result;
assert.equal(streamed.status, "resolved");
assert(streamed.previewId);
assert.equal(
  (await api("bikes/resolve", "POST", { ...q, url: "http://localhost" }))
    .status,
  400,
);
const resolved = await api("bikes/resolve", "POST", q);
assert.equal(resolved.data.status, "resolved");
assert(resolved.data.components.length > 10);
const input = {
  ...q,
  name: "Giant",
  category: "road",
  description: "",
  color: "",
  size: "",
  weight: null,
};
const { id } = (await api("bikes", "POST", input)).data;
const imported = await api("bikes/" + id + "/factory-spec", "POST", {
  initializeCurrent: true,
});
assert.equal(imported.data.status, "resolved");
assert(imported.data.importedCount > 10);
const bike = (await api("bikes/" + id)).data.bike;
assert.equal(bike.components.length, resolved.data.components.length);
assert.equal(bike.factory_spec.source.url, resolved.data.source.url);
const part = bike.components[0];
await api("bikes/" + id + "/components/" + part.id, "PATCH", {
  ...part,
  name: "Custom component",
});
assert.equal(
  (
    await api("bikes/" + id + "/factory-spec", "POST", {
      initializeCurrent: true,
    })
  ).data.importedCount,
  0,
);
const again = (await api("bikes/" + id)).data.bike;
assert.equal(again.components.length, bike.components.length);
assert.equal(
  again.components.find((c) => c.id === part.id).name,
  "Custom component",
);
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  await db.query("UPDATE users SET role='admin' WHERE id=$1", [user.id]);
  assert.equal(
    (await stream("admin/resolver/inspect", q, "https://evil.example")).status,
    403,
  );
  const inspected = await stream("admin/resolver/inspect");
  assert.equal(inspected.status, 200);
  assert.equal(inspected.items.at(-1).result.previewId, undefined);
  const diag = await api("admin/resolver/diagnostics");
  assert.equal(diag.status, 200);
  assert.equal(diag.data.extractorVersion, 2);
  const preview = await db.query(
    "SELECT owner_id FROM resolver_previews WHERE id=$1",
    [streamed.previewId],
  );
  assert.equal(preview.rows[0].owner_id, user.id);
  const config = (await api("admin/resolver")).data;
  assert.equal(
    (
      await api(
        "admin/resolver",
        "PUT",
        { value: config.value, version: config.version },
        "https://evil.example",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await api("admin/resolver", "PUT", {
        value: { ...config.value, enabled: false },
        version: config.version,
      })
    ).status,
    200,
  );
  assert.equal((await api("bikes/resolver-brands")).data.autoResolve, false);
  assert.equal(
    (await api("bikes/resolve", "POST", q)).data.status,
    "unsupported_brand",
  );
  assert.equal(
    (await api("bikes", "POST", { ...input, name: "Manual while disabled" }))
      .status,
    201,
  );
  const changed = (await api("admin/resolver")).data;
  await api("admin/resolver", "PUT", {
    value: config.value,
    version: changed.version,
  });
  assert.equal(
    (await api("admin/resolver/cache?adapter=giant", "DELETE")).status,
    200,
  );
  const audit = await db.query(
    "SELECT action FROM admin_audit WHERE actor_id=$1 AND action LIKE 'resolver.%'",
    [user.id],
  );
  assert(audit.rows.length >= 3);
} finally {
  await db.query("DELETE FROM users WHERE id=$1", [user.id]);
  await db.end();
}
console.log(
  "Resolver HTTP integration: resolve, import, idempotency, current parts, admin auth/origin/settings/audit and manual fallback passed.",
);
