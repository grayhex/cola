import test from "node:test";
import assert from "node:assert/strict";
import {
  parsePublicReference, publicPath, publicHandle, profilePath,
  publicOrigin, absolutePublicUrl, preserveSearch,
} from "../lib/public-urls.js";
import { previewText, socialMetadata } from "../lib/social-metadata.js";

const id = "03ab9xyz";
const legacy = "10000000-0000-4000-8000-000000000001";
test("public references resolve by the immutable suffix, not the mutable slug", () => {
  for (const reference of [id, `canyon-grail-${id}`, `old-name-${id}`, `мой-старый-байк-${id}`, `UPPER-${id.toUpperCase()}`])
    assert.deepEqual(parsePublicReference(reference), { publicId: id });
  assert.deepEqual(parsePublicReference(legacy.toUpperCase()), { legacyId: legacy });
  for (const reference of [null, "", "abc", "abc123456", "foo-", "foo-../" + id, "//evil/" + id, "foo\n-" + id, "x".repeat(513)])
    assert.equal(parsePublicReference(reference), null);
  assert.equal(publicHandle({ slug: "new-title", public_id: id }), `new-title-${id}`);
});

test("canonical paths encode Unicode once and preserve the public family", () => {
  for (const [kind, prefix] of [["bike", "/b/"], ["journal", "/j/"], ["ride", "/r/"], ["market", "/market/"]]) {
    const entity = { slug: "мой-байк", public_id: id };
    const path = publicPath(kind, entity);
    assert.equal(path, prefix + encodeURIComponent(`мой-байк-${id}`));
    assert.deepEqual(parsePublicReference(decodeURIComponent(path.slice(prefix.length))), { publicId: id });
    assert.equal(publicPath(kind, { ...entity, slug: "renamed" }), prefix + `renamed-${id}`);
  }
  assert.equal(profilePath("@Rider.Name-1"), "/@rider.name-1");
  assert.equal(publicPath("profile", { slug: "rider_name" }), "/@rider_name");
  assert.throws(() => publicPath("unknown", {}), TypeError);
});

test("absolute preview URLs trust configuration only and require public HTTPS", () => {
  const env = { APP_ORIGIN: "https://colabike.example" };
  assert.equal(absolutePublicUrl("/b/bike-" + id, env), "https://colabike.example/b/bike-" + id);
  assert.equal(publicOrigin({ ...env, PUBLIC_SITE_URL: "https://canonical.example/" }), "https://canonical.example");
  for (const origin of ["http://localhost:3100", "http://127.0.0.1:3000", "http://[::1]:3000"])
    assert.equal(publicOrigin({ APP_ORIGIN: origin }), origin);
  for (const origin of ["http://public.example", "http://localhost.evil", "javascript:alert(1)", "https://user:pass@example.org", "https://example.org/path", "https://example.org/?x=1", "https://example.org/#x"])
    assert.throws(() => publicOrigin({ PUBLIC_SITE_URL: origin }));
  for (const path of ["https://evil.test", "//evil.test", "/\\evil.test"])
    assert.throws(() => absolutePublicUrl(path, env), TypeError);
  assert.equal(preserveSearch("/b/bike-" + id, { comment: "123", tag: ["a", "b"], empty: "", absent: undefined }),
    "/b/bike-" + id + "?comment=123&tag=a&tag=b&empty=");
});

test("metadata is a complete public descriptor with an extensible image endpoint", () => {
  for (const kind of ["bike", "journal", "ride", "market", "profile"]) {
    const link = { public_id: id, slug: "rider" };
    const path = publicPath(kind, link);
    const metadata = socialMetadata({ kind, link, path, title: "Мой велосипед", description: "Публичное описание" }, { APP_ORIGIN: "https://colabike.example" });
    assert.equal(metadata.openGraph.title, "Мой велосипед");
    assert.equal(metadata.openGraph.description, "Публичное описание");
    assert.equal(metadata.openGraph.siteName, "ColaBike");
    assert.equal(metadata.openGraph.url, metadata.alternates.canonical);
    assert.equal(metadata.openGraph.url, "https://colabike.example" + path);
    assert.equal(metadata.openGraph.images[0].url, `https://colabike.example/api/social-preview/${kind}/${id}/image`);
    assert.equal(metadata.twitter.card, "summary_large_image");
    assert.equal(metadata.twitter.images[0], metadata.openGraph.images[0].url);
  }
  const hidden = socialMetadata(null);
  assert.equal(hidden.title.absolute, "ColaBike");
  assert.equal(hidden.robots.index, false);
  assert.equal(hidden.alternates, undefined);
  assert.deepEqual(hidden.openGraph.images, []);
});

test("preview descriptions are bounded plain text without Markdown image URLs", () => {
  assert.equal(previewText("# История **байка**\n[ссылка](https://example.test) ![secret](https://private.test/image) <b>текст</b>"), "История байка ссылка текст");
  assert.equal(previewText("a".repeat(400)).length, 200);
  assert.equal(previewText("a".repeat(400)).endsWith("…"), true);
  assert.equal(previewText(null), "");
});
