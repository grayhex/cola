import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { appConfigSchema, type AppConfig } from "../lib/api-v1/schemas.ts";
import {
  MOBILE_LIMITS,
  confirmationsNeeded,
  defaultMobileSettings,
  linkProblem,
  mobileAssetIds,
  mobileFeatures,
  mobileLinkHref,
  mobileSettingsProblems,
  mobileSettingsSchema,
  normalizeHost,
  storedMobileSettings,
  type MobileSettings,
} from "../lib/mobile-config.ts";
import {
  MobileSettingsError,
  adminMobileSettings,
  appConfig,
  appConfigEtag,
  appConfigOf,
  mobileAssetInUse,
  saveMobileSettings,
} from "../lib/mobile-settings.ts";
import {
  deleteUnusedAssets,
  listAssetLibrary,
} from "../lib/site-asset-library.ts";
import type { MobileSettingsRow } from "../lib/database-rows.ts";
import { siteAssetRow } from "./support/assets.ts";
import { seedSiteDefaults, testDatabase } from "./support/database.ts";
import { processEnv } from "./support/env.ts";
import { userRow } from "./support/people.ts";

// Settings of the native apps (#338): the stored schema, the link allowlist,
// the public DTO and the versioned, audited save that protects its images.

const origin = "https://colabike.example";
const env = processEnv({ PUBLIC_SITE_URL: origin });
const settings = (patch: (value: MobileSettings) => void = () => {}) => {
  const value = defaultMobileSettings();
  patch(value);
  return value;
};
// The stored row as the service reads it.
const row = (value: unknown, version = 1): MobileSettingsRow => ({
  id: 1,
  value,
  version,
  onboarding_revision: 1,
  notice_revision: 1,
  updated_at: new Date("2026-10-03T12:00:00Z"),
});

test("defaults: everything off, links to the site, known features on, no version policy", () => {
  const value = defaultMobileSettings();
  assert.equal(value.launch.enabled, false);
  assert.equal(value.launch.contentMode, "crop");
  assert.deepEqual(value.onboarding, { enabled: false, items: [] });
  assert.equal(value.notice.enabled, false);
  assert.deepEqual(value.links, {
    help: null,
    privacy: null,
    terms: null,
    about: null,
    support: null,
  });
  assert.deepEqual(value.features, {
    chat: true,
    market: true,
    componentCatalog: true,
    rides: true,
    bikeEditor: true,
    journalEditor: true,
    nativeYandexSignIn: true,
  });
  assert.deepEqual(value.compatibility, {
    minimumSupportedVersionCode: null,
    latestVersionCode: null,
    updateMode: "soft",
    updateUrl: null,
    updateMessage: null,
  });
  // A stored older value keeps the features it named and gets the rest.
  assert.equal(
    mobileSettingsSchema.parse({ features: { market: false } }).features.chat,
    true,
  );
});

test("the schema is strict and plain-text only", () => {
  const rejects = (input: unknown) =>
    assert.equal(mobileSettingsSchema.safeParse(input).success, false);
  rejects({ theme: { primary: "#f00" } });
  rejects({ launch: { css: "body{}" } });
  rejects({ launch: { contentMode: "stretch" } });
  rejects({ launch: { assetId: "../../etc/passwd" } });
  rejects({ notice: { kind: "modal" } });
  rejects({ notice: { title: "Строка\nдве" } });
  rejects({ notice: { title: "Ноль\u0000" } });
  rejects({ notice: { title: "x".repeat(81) } });
  rejects({ onboarding: { items: [{ title: "" }] } });
  rejects({
    onboarding: {
      items: Array.from(
        { length: MOBILE_LIMITS.onboardingItems + 1 },
        (_, i) => ({ title: "Карточка " + i }),
      ),
    },
  });
  // Markup is just text: the app never renders it.
  const html = mobileSettingsSchema.parse({
    notice: { title: "<b>Акция</b>", body: "Первая\r\nвторая <script>" },
  }).notice;
  assert.equal(html.title, "<b>Акция</b>");
  assert.equal(html.body, "Первая\nвторая <script>");
  // Empty optional text is null; asset ids are lower case.
  const upper = randomUUID().toUpperCase();
  const parsed = mobileSettingsSchema.parse({
    launch: { title: "   ", assetId: upper },
  });
  assert.equal(parsed.launch.title, null);
  assert.equal(parsed.launch.assetId, upper.toLowerCase());
});

test("feature keys: camelCase, bounded, no prototype names; unknown ones are kept", () => {
  const parse = (features: Record<string, boolean>) =>
    mobileSettingsSchema.safeParse({ features });
  assert.equal(parse({ rideRecording: true }).success, true);
  for (const key of ["Chat", "ride-recording", "ride_recording", "1chat", ""])
    assert.equal(parse({ [key]: true }).success, false, key);
  for (const key of ["constructor", "toString", "hasOwnProperty"])
    assert.equal(parse({ [key]: true }).success, false, key);
  assert.equal(parse({ x: true, ["a".repeat(41)]: true }).success, false);
  const many = Object.fromEntries(
    Array.from({ length: MOBILE_LIMITS.features + 1 }, (_, i) => [
      "flag" + i,
      true,
    ]),
  );
  assert.equal(parse(many).success, false);
  // The limit counts the built-in keys too, even when the input leaves them
  // out: otherwise the stored value would fail its own schema when read back.
  const custom = (count: number) =>
    Object.fromEntries(
      Array.from({ length: count }, (_, i) => ["future" + i, true]),
    );
  assert.equal(parse(custom(MOBILE_LIMITS.features)).success, false);
  const room = MOBILE_LIMITS.features - mobileFeatures.length;
  assert.equal(parse(custom(room + 1)).success, false);
  const full = mobileSettingsSchema.parse({ features: custom(room) });
  assert.equal(Object.keys(full.features).length, MOBILE_LIMITS.features);
  assert.deepEqual(storedMobileSettings(full).features, full.features);
  const kept = mobileSettingsSchema.parse({
    features: { rideRecording: false },
  });
  assert.equal(kept.features.rideRecording, false);
});

test("version codes: positive integers up to Android's limit, minimum not above latest", () => {
  const parse = (compatibility: Record<string, unknown>) =>
    mobileSettingsSchema.safeParse({ compatibility });
  for (const code of [0, -1, 1.5, MOBILE_LIMITS.versionCode + 1, "7"])
    assert.equal(
      parse({ minimumSupportedVersionCode: code }).success,
      false,
      String(code),
    );
  assert.equal(
    parse({ latestVersionCode: MOBILE_LIMITS.versionCode }).success,
    true,
  );
  const problems = (patch: (value: MobileSettings) => void) =>
    mobileSettingsProblems(settings(patch), origin).map((p) => p.path);
  assert.deepEqual(
    problems((v) => {
      v.compatibility.minimumSupportedVersionCode = 20;
      v.compatibility.latestVersionCode = 10;
    }),
    ["compatibility.latestVersionCode"],
  );
  assert.deepEqual(
    problems((v) => {
      v.compatibility.updateMode = "hard";
    }),
    ["compatibility.minimumSupportedVersionCode", "compatibility.updateUrl"],
  );
  assert.deepEqual(
    problems((v) => {
      v.compatibility.updateMode = "hard";
      v.compatibility.minimumSupportedVersionCode = 3;
      v.compatibility.updateUrl = "/app";
    }),
    [],
  );
});

test("links: site pages and https on allowed hosts only", () => {
  const hosts = ["rustore.ru", "t.me"];
  const ok = (value: string) =>
    assert.equal(linkProblem(value, origin, hosts), null, value);
  const refused = (value: string) =>
    assert.notEqual(linkProblem(value, origin, hosts), null, value);
  ok("/legal/privacy");
  ok("/about#guide");
  ok("/market?sort=new");
  ok(origin + "/rides");
  ok("https://rustore.ru/catalog/app/ru.colabike.app");
  ok("https://t.me/colabike");
  refused("//evil.example/x");
  refused("/\\evil.example");
  refused("/a b");
  refused("javascript:alert(1)");
  refused("JAVASCRIPT:alert(1)");
  refused("intent://scan/#Intent;scheme=zxing;end");
  refused("colabike://bikes");
  refused("data:text/html,<script>");
  refused("http://rustore.ru/app");
  refused("http://colabike.example/rides");
  refused("https://www.rustore.ru/app");
  refused("https://evil.example/");
  refused("https://colabike.example.evil.example/");
  refused("https://user:pass@rustore.ru/");
  refused("https://evil.example@rustore.ru/");
  refused("https://rustore.ru:8443/");
  refused("mailto:help@colabike.example");
  refused("about");
  assert.equal(
    mobileLinkHref("/about#guide", origin, []),
    origin + "/about#guide",
  );
  assert.equal(normalizeHost(" RuStore.RU "), "rustore.ru");
  assert.equal(normalizeHost("пример.рф"), "xn--e1afmkfd.xn--p1ai");
  for (const host of [
    "https://rustore.ru",
    "rustore.ru/app",
    "rustore.ru:443",
    "user@rustore.ru",
    "localhost",
    "127.0.0.1",
    "-bad.ru",
    "a..ru",
    "",
  ])
    assert.equal(normalizeHost(host), null, host);
  const stored = mobileSettingsSchema.parse({
    externalHosts: ["T.me", "t.me", "rustore.ru"],
  });
  assert.deepEqual(stored.externalHosts, ["t.me", "rustore.ru"]);
  assert.equal(
    mobileSettingsSchema.safeParse({ externalHosts: ["https://t.me"] }).success,
    false,
  );
});

test("rules across fields name the field to fix", () => {
  const paths = (patch: (value: MobileSettings) => void) =>
    mobileSettingsProblems(settings(patch), origin).map((p) => p.path);
  assert.deepEqual(
    paths((v) => {
      v.launch.enabled = true;
    }),
    ["launch.assetId"],
  );
  assert.deepEqual(
    paths((v) => {
      v.onboarding.enabled = true;
    }),
    ["onboarding.items"],
  );
  assert.deepEqual(
    paths((v) => {
      v.notice.enabled = true;
    }),
    ["notice.title"],
  );
  assert.deepEqual(
    paths((v) => {
      v.notice.actionLabel = "Открыть";
    }),
    ["notice.actionUrl"],
  );
  assert.deepEqual(
    paths((v) => {
      v.notice.actionUrl = "https://evil.example";
      v.links.support = "javascript:alert(1)";
      v.compatibility.updateUrl = "colabike://update";
    }),
    [
      "notice.actionLabel",
      "notice.actionUrl",
      "links.support",
      "compatibility.updateUrl",
    ],
  );
});

test("hard update and maintenance need an explicit confirmation", () => {
  const hard = (minimum: number) =>
    settings((v) => {
      v.compatibility.updateMode = "hard";
      v.compatibility.minimumSupportedVersionCode = minimum;
      v.compatibility.updateUrl = "/app";
    });
  const soft = settings();
  assert.deepEqual(confirmationsNeeded(soft, hard(5)), ["hardUpdate"]);
  assert.deepEqual(confirmationsNeeded(hard(5), hard(5)), []);
  assert.deepEqual(confirmationsNeeded(hard(5), hard(4)), []);
  assert.deepEqual(confirmationsNeeded(hard(5), hard(6)), ["hardUpdate"]);
  assert.deepEqual(confirmationsNeeded(hard(5), soft), []);
  const notice = (kind: "promo" | "maintenance", enabled = true) =>
    settings((v) => {
      v.notice = { ...v.notice, enabled, kind, title: "Работы" };
    });
  assert.deepEqual(confirmationsNeeded(soft, notice("maintenance")), [
    "maintenance",
  ]);
  assert.deepEqual(
    confirmationsNeeded(notice("promo"), notice("maintenance")),
    ["maintenance"],
  );
  assert.deepEqual(
    confirmationsNeeded(notice("maintenance"), notice("maintenance")),
    [],
  );
  assert.deepEqual(confirmationsNeeded(soft, notice("maintenance", false)), []);
});

test("reading tolerates a broken block: only that block falls back", () => {
  const launch = randomUUID();
  const value = storedMobileSettings({
    launch: { enabled: true, assetId: launch, futureField: 1 },
    notice: { enabled: true, title: "Новое", kind: "promo" },
    somethingNew: { a: 1 },
  });
  assert.deepEqual(value.launch, defaultMobileSettings().launch);
  assert.equal(value.notice.title, "Новое");
  assert.deepEqual(storedMobileSettings("garbage"), defaultMobileSettings());
  // Protection reads the raw value, so the broken block's image stays used.
  assert.deepEqual(
    mobileAssetIds({ launch: { assetId: launch, futureField: 1 } }),
    [launch],
  );
});

test("asset ids: every block, enabled or not, unique, lower case, sorted", () => {
  const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()].sort();
  assert.deepEqual(
    mobileAssetIds({
      launch: { enabled: false, assetId: c.toUpperCase() },
      onboarding: {
        items: [{ assetId: b }, { assetId: null }, "x", { assetId: c }],
      },
      notice: { assetId: a },
    }),
    [a, b, c],
  );
  for (const raw of [null, "x", [], { launch: { assetId: "nope" } }])
    assert.deepEqual(mobileAssetIds(raw), []);
});

function keysOf(value: unknown, at = ""): string[] {
  if (Array.isArray(value))
    return value.flatMap((item) => keysOf(item, at + "[]"));
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => [
    at + "." + key,
    ...(at === ".features" ? [] : keysOf(child, at + "." + key)),
  ]);
}

test("public DTO: allowlisted fields, absolute links, relative public images", () => {
  const [image, card] = [randomUUID(), randomUUID()];
  const value = settings((v) => {
    v.launch = {
      enabled: true,
      assetId: image,
      name: "Внутреннее название",
      contentMode: "fit",
      title: "Привет",
    };
    v.onboarding = {
      enabled: true,
      items: [{ title: "Шаг", body: null, assetId: card }],
    };
    v.notice = {
      enabled: true,
      kind: "service",
      title: "Новое",
      body: "Текст",
      assetId: null,
      actionLabel: "Открыть",
      actionUrl: "https://t.me/colabike",
    };
    v.externalHosts = ["t.me"];
    v.links.support = "https://t.me/colabike_help";
    v.features.rideRecording = true;
  });
  const config = appConfigOf(row(value, 7), env);
  assert.deepEqual(appConfigSchema.parse(config), config);
  assert.equal(config.revision, 7);
  assert.equal(config.updatedAt, "2026-10-03T12:00:00.000Z");
  assert.deepEqual(config.launch, {
    enabled: true,
    imageUrl: "/api/assets/" + image,
    contentMode: "fit",
    title: "Привет",
  });
  assert.deepEqual(config.onboarding.items, [
    { title: "Шаг", body: null, imageUrl: "/api/assets/" + card },
  ]);
  assert.deepEqual(config.notice?.action, {
    label: "Открыть",
    url: "https://t.me/colabike",
  });
  assert.deepEqual(config.links, {
    help: origin + "/about#guide",
    privacy: origin + "/legal/privacy",
    terms: origin + "/legal/terms",
    about: origin + "/about",
    support: "https://t.me/colabike_help",
  });
  assert.equal(config.features.rideRecording, true);
  // Only the contract's keys: no admin label, hosts or raw asset ids.
  const text = JSON.stringify(config);
  assert.doesNotMatch(text, /Внутреннее название|externalHosts|assetId|name/);
  assert.deepEqual(
    [...new Set(keysOf(config).map((key) => key.replace(/^\./, "")))].sort(),
    [
      "compatibility",
      "compatibility.latestVersionCode",
      "compatibility.minimumSupportedVersionCode",
      "compatibility.updateMessage",
      "compatibility.updateMode",
      "compatibility.updateUrl",
      "features",
      "features.bikeEditor",
      "features.chat",
      "features.componentCatalog",
      "features.journalEditor",
      "features.market",
      "features.nativeYandexSignIn",
      "features.rides",
      "features.rideRecording",
      "launch",
      "launch.contentMode",
      "launch.enabled",
      "launch.imageUrl",
      "launch.title",
      "links",
      "links.about",
      "links.help",
      "links.privacy",
      "links.support",
      "links.terms",
      "notice",
      "notice.action",
      "notice.action.label",
      "notice.action.url",
      "notice.body",
      "notice.imageUrl",
      "notice.kind",
      "notice.revision",
      "notice.title",
      "onboarding",
      "onboarding.enabled",
      "onboarding.items",
      "onboarding.items[].body",
      "onboarding.items[].imageUrl",
      "onboarding.items[].title",
      "onboarding.revision",
      "revision",
      "updatedAt",
    ].sort(),
  );
  // Switched off: nothing of the block is published.
  const off = appConfigOf(
    row(
      settings((v) => {
        v.launch = { ...value.launch, enabled: false };
        v.onboarding = { ...value.onboarding, enabled: false };
        v.notice = { ...value.notice, enabled: false };
      }),
    ),
    env,
  );
  assert.deepEqual(off.launch, {
    enabled: false,
    imageUrl: null,
    contentMode: "fit",
    title: null,
  });
  assert.deepEqual(off.onboarding.items, []);
  assert.equal(off.notice, null);
});

test("features needing server setup are on only when the server is ready", () => {
  const ready = processEnv({
    PUBLIC_SITE_URL: origin,
    STREAM_CHAT_ENABLED: "true",
    STREAM_CHAT_API_KEY: "public-key",
    STREAM_CHAT_API_SECRET: "secret",
    YANDEX_ID_ENABLED: "true",
    YANDEX_ID_CLIENT_ID: "client",
    YANDEX_ID_CLIENT_SECRET: "secret",
    APP_ORIGIN: origin,
    NATIVE_AUTH_RETURN_URL: origin + "/app/auth",
  });
  const features = (value: MobileSettings, environment: NodeJS.ProcessEnv) =>
    appConfigOf(row(value), environment).features;
  assert.equal(features(settings(), env).chat, false);
  assert.equal(features(settings(), env).nativeYandexSignIn, false);
  assert.equal(features(settings(), ready).chat, true);
  assert.equal(features(settings(), ready).nativeYandexSignIn, true);
  // Yandex ID alone is not enough: the app needs its return link too.
  assert.equal(
    features(settings(), { ...ready, NATIVE_AUTH_RETURN_URL: "" })
      .nativeYandexSignIn,
    false,
  );
  // A switch turned off stays off on a ready server.
  const off = settings((v) => {
    v.features.chat = false;
    v.features.nativeYandexSignIn = false;
  });
  assert.equal(features(off, ready).chat, false);
  assert.equal(features(off, ready).nativeYandexSignIn, false);
  // Nothing of the server's configuration leaks into the answer.
  assert.doesNotMatch(
    JSON.stringify(appConfigOf(row(settings()), ready)),
    /secret|client|public-key/,
  );
});

test("a link that no longer passes is replaced, and a hard mode without its link turns soft", () => {
  const value = settings((v) => {
    v.links.privacy = origin + "/private-policy";
    v.compatibility = {
      minimumSupportedVersionCode: 10,
      latestVersionCode: 12,
      updateMode: "hard",
      updateUrl: origin + "/app",
      updateMessage: "Обновите приложение",
    };
  });
  const moved = processEnv({ PUBLIC_SITE_URL: "https://new.example" });
  const config = appConfigOf(row(value), moved);
  assert.equal(config.links.privacy, "https://new.example/legal/privacy");
  assert.equal(config.compatibility.updateMode, "soft");
  assert.equal(config.compatibility.updateUrl, null);
  assert.equal(appConfigOf(row(value), env).compatibility.updateMode, "hard");
});

test("ETag follows the answer: same config, same tag; any change, a new one", () => {
  const first = appConfigOf(row(settings(), 3), env);
  const again = appConfigOf(row(settings(), 3), env);
  assert.equal(appConfigEtag(first), appConfigEtag(again));
  assert.match(appConfigEtag(first), /^"app-config-[\w-]{32}"$/);
  const next: AppConfig = appConfigOf(row(settings(), 4), env);
  assert.notEqual(appConfigEtag(first), appConfigEtag(next));
});

const db = await testDatabase();
after(() => db.close());
await seedSiteDefaults(db);
const actor = (await userRow(db, { role: "admin" })).id;
const audits: { action: string; target: string }[] = [];
const save = (input: unknown) =>
  db.transaction((q) =>
    saveMobileSettings(
      q,
      actor,
      input,
      async (_q, _actor, action, target) => {
        audits.push({ action, target });
      },
      env,
    ),
  );
async function rejectsWith(
  promise: Promise<unknown>,
  status: number,
  code: string,
) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof MobileSettingsError, String(error));
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    return true;
  });
}

test("the migration gives a default row: version 1, public defaults", async () => {
  const stored = await adminMobileSettings(db, env);
  assert.equal(stored.version, 1);
  assert.deepEqual(stored.value, defaultMobileSettings());
  assert.deepEqual(stored.revisions, { onboarding: 1, notice: 1 });
  const published = await appConfig(db, env);
  assert.equal(published.revision, 1);
  assert.deepEqual(stored.published, published);
});

test("saving: versioned, audited, conflicts refused, images locked and raster only", async () => {
  const before = await adminMobileSettings(db, env);
  const image = (await siteAssetRow(db)).id;
  const value = settings((v) => {
    v.launch = { ...v.launch, enabled: true, assetId: image };
  });
  const saved = await save({ value, version: before.version });
  assert.equal(saved.version, before.version + 1);
  assert.equal(saved.published.launch.imageUrl, "/api/assets/" + image);
  assert.deepEqual(audits.at(-1), {
    action: "mobile.update",
    target: String(saved.version),
  });
  // Another admin's stale version.
  await rejectsWith(
    save({ value, version: before.version }),
    409,
    "version_conflict",
  );
  // Cross-field rules and the input schema are checked before the database.
  await rejectsWith(
    save({
      value: settings((v) => {
        v.launch.enabled = true;
      }),
      version: saved.version,
    }),
    400,
    "invalid_settings",
  );
  await assert.rejects(
    save({ value: { theme: "dark" }, version: saved.version }),
    (error: unknown) => error instanceof Error && error.name === "ZodError",
  );
  const missing = randomUUID();
  await rejectsWith(
    save({
      value: settings((v) => {
        v.notice.assetId = missing;
      }),
      version: saved.version,
    }),
    409,
    "asset_missing",
  );
  const svg = randomUUID();
  const vector = (
    await siteAssetRow(db, { id: svg, filename: `site-${svg}.svg` })
  ).id;
  await rejectsWith(
    save({
      value: settings((v) => {
        v.onboarding.items = [{ title: "Шаг", body: null, assetId: vector }];
      }),
      version: saved.version,
    }),
    400,
    "asset_format",
  );
  const current = await adminMobileSettings(db, env);
  assert.equal(current.version, saved.version, "refused saves change nothing");
});

test("assigned images are used: the library marks them and deletion skips them", async () => {
  const current = await adminMobileSettings(db, env);
  const image = current.value.launch.assetId;
  assert.ok(image);
  assert.equal(await mobileAssetInUse(db, image), true);
  assert.equal(await mobileAssetInUse(db, randomUUID()), false);
  const library = await listAssetLibrary(db);
  assert.deepEqual(library.find((asset) => asset.id === image)?.usage, [
    "Мобильное приложение",
  ]);
  const spare = (await siteAssetRow(db)).id;
  const result = await db.transaction((q) =>
    deleteUnusedAssets(q, [image, spare]),
  );
  assert.deepEqual(
    result.deleted.map((asset) => asset.id),
    [spare],
  );
  assert.deepEqual(result.skippedIds, [image]);
});

test("revisions: a changed block gets the new version unless the admin keeps it", async () => {
  let current = await adminMobileSettings(db, env);
  const onboarding = (title: string) =>
    settings((v) => {
      v.launch = current.value.launch;
      v.onboarding = {
        enabled: true,
        items: [{ title, body: null, assetId: null }],
      };
    });
  current = await save({
    value: onboarding("Привет"),
    version: current.version,
  });
  assert.equal(current.revisions.onboarding, current.version);
  const noticeBefore = current.revisions.notice;
  // A typo fixed quietly keeps the edition people already saw.
  const quiet = await save({
    value: onboarding("Привет!"),
    version: current.version,
    keepRevision: { onboarding: true },
  });
  assert.equal(quiet.revisions.onboarding, current.revisions.onboarding);
  assert.equal(quiet.published.onboarding.items[0].title, "Привет!");
  // An unrelated block keeps its revision.
  assert.equal(quiet.revisions.notice, noticeBefore);
  const fresh = await save({
    value: onboarding("Новое"),
    version: quiet.version,
  });
  assert.equal(fresh.revisions.onboarding, fresh.version);
  assert.equal(fresh.published.onboarding.revision, fresh.version);
});

test("hard update and maintenance are saved only with a confirmation", async () => {
  let current = await adminMobileSettings(db, env);
  const hard = settings((v) => {
    v.launch = current.value.launch;
    v.onboarding = current.value.onboarding;
    v.compatibility = {
      minimumSupportedVersionCode: 5,
      latestVersionCode: 6,
      updateMode: "hard",
      updateUrl: "/app",
      updateMessage: null,
    };
  });
  await rejectsWith(
    save({ value: hard, version: current.version }),
    428,
    "confirmation_required",
  );
  current = await save({
    value: hard,
    version: current.version,
    confirm: { hardUpdate: true },
  });
  assert.equal(current.published.compatibility.updateMode, "hard");
  assert.equal(current.published.compatibility.updateUrl, origin + "/app");
  // Saving the same policy again needs no new confirmation.
  current = await save({ value: hard, version: current.version });
  const maintenance = {
    ...hard,
    notice: {
      ...hard.notice,
      enabled: true,
      kind: "maintenance" as const,
      title: "Технические работы",
    },
  };
  await assert.rejects(
    save({ value: maintenance, version: current.version }),
    (error: unknown) =>
      error instanceof MobileSettingsError &&
      error.status === 428 &&
      JSON.stringify(error.confirm) === JSON.stringify(["maintenance"]),
  );
  current = await save({
    value: maintenance,
    version: current.version,
    confirm: { maintenance: true },
  });
  assert.equal(current.published.notice?.kind, "maintenance");
  assert.equal(current.published.notice?.revision, current.version);
});
