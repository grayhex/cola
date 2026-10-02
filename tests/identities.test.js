import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { safeReturnPath } from "../lib/identities.ts";
import { identityNotice, identitySuccess } from "../lib/identity-messages.ts";
import { validateRuntime } from "../lib/runtime-config.ts";
import {
  YandexIdError,
  exchangeYandexCode,
  fetchYandexProfile,
  newFlowSecrets,
  yandexAuthorizeUrl,
  yandexIdConfig,
  yandexReturn,
} from "../lib/yandex-id.ts";

// Yandex ID sign-in (#151): protocol details against the documented flow,
// with the network replaced by a fake. The HTTP flow, first sign-in, linking
// and refusals run against the real server in identities-http.js.

const env = {
  YANDEX_ID_ENABLED: "true",
  YANDEX_ID_CLIENT_ID: "client-id",
  YANDEX_ID_CLIENT_SECRET: "client-secret",
  APP_ORIGIN: "https://colabike.example",
};
const config = yandexIdConfig(env);

test("the provider is off without explicit enabling and both credentials", () => {
  assert.ok(config);
  assert.equal(
    config.redirectUri,
    "https://colabike.example/api/auth/yandex/callback",
  );
  assert.equal(yandexIdConfig({ ...env, YANDEX_ID_ENABLED: "false" }), null);
  assert.equal(yandexIdConfig({ ...env, YANDEX_ID_ENABLED: undefined }), null);
  assert.equal(yandexIdConfig({ ...env, YANDEX_ID_CLIENT_SECRET: "" }), null);
  assert.equal(yandexIdConfig({ ...env, YANDEX_ID_CLIENT_ID: "" }), null);
  // The return address must be this site over HTTPS (or a local origin).
  assert.equal(
    yandexIdConfig({ ...env, APP_ORIGIN: "http://colabike.example" }),
    null,
  );
  assert.ok(yandexIdConfig({ ...env, APP_ORIGIN: "http://localhost:3000" }));
});

test("production refuses a half-filled configuration, accepts none or all", () => {
  const production = {
    DEPLOYMENT_MODE: "production",
    POSTGRES_PASSWORD: "x7Kq-9vLm2Zr4Tn8Wp3Hs6Yd1Bc5Fg",
    APP_ORIGIN: "https://colabike.example",
    COOKIE_SECURE: "true",
    TRUSTED_PROXY_KEY: "k".repeat(32),
    BIKE_RESOLVER_TOKEN: "t".repeat(32),
    DATABASE_URL: "postgres://u:p@db/cola",
    BIKE_RESOLVER_URL: "http://resolver:8080",
  };
  assert.equal(validateRuntime(production).mode, "production");
  assert.equal(
    validateRuntime({ ...production, ...env, YANDEX_ID_ENABLED: "true" }).mode,
    "production",
  );
  assert.throws(
    () => validateRuntime({ ...production, YANDEX_ID_ENABLED: "true" }),
    /YANDEX_ID_CLIENT_ID/,
  );
});

test("authorization request: code flow, exact redirect, narrow scope, state and PKCE S256", () => {
  const { state, verifier, challenge } = newFlowSecrets();
  assert.match(state, /^[A-Za-z0-9_-]{43}$/);
  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(
    challenge,
    createHash("sha256").update(verifier).digest("base64url"),
  );
  assert.notEqual(
    state,
    newFlowSecrets().state,
    "every flow gets fresh randomness",
  );
  const url = new URL(yandexAuthorizeUrl(config, state, challenge));
  assert.equal(url.origin + url.pathname, "https://oauth.yandex.ru/authorize");
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    response_type: "code",
    client_id: "client-id",
    redirect_uri: "https://colabike.example/api/auth/yandex/callback",
    scope: "login:info",
    optional_scope: "login:email",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  assert.ok(
    !url.toString().includes("client-secret"),
    "the secret never goes to the browser",
  );
});

test("the return URL accepts only a well-formed state with a code or an error", () => {
  const state = "A".repeat(43);
  assert.ok(yandexReturn.safeParse({ state, code: "abc123" }).success);
  assert.ok(yandexReturn.safeParse({ state, error: "access_denied" }).success);
  assert.ok(!yandexReturn.safeParse({ code: "abc" }).success);
  assert.ok(!yandexReturn.safeParse({ state: "short", code: "abc" }).success);
  assert.ok(!yandexReturn.safeParse({ state, code: "a b" }).success);
  assert.ok(!yandexReturn.safeParse({ state, code: "x".repeat(513) }).success);
});

test("code exchange: Basic credentials, urlencoded body with the verifier, token only", async () => {
  let seen;
  const fake = async (url, init) => {
    seen = { url, init };
    return Response.json({
      token_type: "bearer",
      access_token: "tok",
      expires_in: 100,
      refresh_token: "never-kept",
    });
  };
  assert.equal(
    await exchangeYandexCode(config, "code1", "v".repeat(43), fake),
    "tok",
  );
  assert.equal(seen.url, "https://oauth.yandex.ru/token");
  assert.equal(seen.init.method, "POST");
  assert.equal(seen.init.redirect, "error");
  assert.equal(
    seen.init.headers["Content-Type"],
    "application/x-www-form-urlencoded",
  );
  assert.equal(
    seen.init.headers.Authorization,
    "Basic " + Buffer.from("client-id:client-secret").toString("base64"),
  );
  assert.deepEqual(Object.fromEntries(new URLSearchParams(seen.init.body)), {
    grant_type: "authorization_code",
    code: "code1",
    code_verifier: "v".repeat(43),
  });
  const refuse = (status) => async () => new Response("{}", { status });
  await assert.rejects(
    exchangeYandexCode(config, "c", "v", refuse(400)),
    YandexIdError,
  );
  await assert.rejects(
    exchangeYandexCode(config, "c", "v", async () =>
      Response.json({ token_type: "mac", access_token: "t" }),
    ),
    YandexIdError,
  );
  await assert.rejects(
    exchangeYandexCode(config, "c", "v", async () => new Response("not json")),
    YandexIdError,
  );
  await assert.rejects(
    exchangeYandexCode(config, "c", "v", async () => {
      throw new TypeError("network");
    }),
    YandexIdError,
  );
});

test("profile: the stable id is the subject; name falls back; email is optional and lower-cased", async () => {
  const reply = (body) => async (url, init) => {
    assert.equal(url, "https://login.yandex.ru/info?format=json");
    assert.equal(
      init.headers.Authorization,
      "OAuth tok",
      "the token goes in the header, never the URL",
    );
    return Response.json(body);
  };
  const full = await fetchYandexProfile(
    config,
    "tok",
    reply({
      id: "1000034426",
      login: "ivan",
      client_id: "client-id",
      display_name: " Иван ",
      real_name: "Иван Иванов",
      default_email: "Ivan@Yandex.RU",
    }),
  );
  assert.deepEqual(full, {
    subject: "1000034426",
    name: "Иван",
    email: "ivan@yandex.ru",
  });
  // A numeric id is still the same subject; login is the last name fallback.
  const numeric = await fetchYandexProfile(
    config,
    "tok",
    reply({ id: 42, login: "ivan", client_id: "client-id" }),
  );
  assert.deepEqual(numeric, { subject: "42", name: "ivan", email: null });
  // A refused or malformed address is absent, never invented.
  for (const bad of [null, "", "not an address", "a@b"])
    assert.equal(
      (
        await fetchYandexProfile(
          config,
          "tok",
          reply({ id: "1", client_id: "client-id", default_email: bad }),
        )
      ).email,
      null,
    );
  assert.equal(
    (
      await fetchYandexProfile(
        config,
        "tok",
        reply({
          id: "1",
          client_id: "client-id",
          display_name: "x".repeat(200),
        }),
      )
    ).name.length,
    60,
  );
});

test("a token issued to another application or an unusable id signs nobody in", async () => {
  const reply = (body) => async () => Response.json(body);
  await assert.rejects(
    fetchYandexProfile(config, "t", reply({ id: "1", client_id: "other" })),
    YandexIdError,
  );
  await assert.rejects(
    fetchYandexProfile(config, "t", reply({ id: "1" })),
    YandexIdError,
  );
  await assert.rejects(
    fetchYandexProfile(config, "t", reply({ client_id: "client-id" })),
    YandexIdError,
  );
  await assert.rejects(
    fetchYandexProfile(
      config,
      "t",
      reply({ id: "../x", client_id: "client-id" }),
    ),
    YandexIdError,
  );
  await assert.rejects(
    fetchYandexProfile(
      config,
      "t",
      async () => new Response("", { status: 401 }),
    ),
    YandexIdError,
  );
});

test("return paths stay on this site", () => {
  assert.equal(safeReturnPath("/market?x=1#h"), "/market?x=1");
  assert.equal(safeReturnPath("/@rider"), "/@rider");
  for (const bad of [
    undefined,
    null,
    42,
    "",
    "market",
    "//evil.test",
    "/\\evil.test",
    "https://evil.test/",
    "javascript:alert(1)",
    "/%2F/evil",
    "/ok\nnext",
    "/\t/evil.test",
    "/api/auth/logout",
    "/" + "a".repeat(300),
  ]) {
    const result = safeReturnPath(bad);
    // Whatever comes in, the result is a same-site path or the account page.
    assert.ok(result.startsWith("/") && !result.startsWith("//"), String(bad));
    assert.ok(
      !result.includes("\\") && !result.startsWith("/api/"),
      String(bad),
    );
  }
  for (const bad of [
    "//evil.test",
    "https://evil.test/",
    "/\\evil.test",
    "/api/auth/logout",
    "market",
  ])
    assert.equal(safeReturnPath(bad), "/account");
});

test("notice codes map to fixed text; unknown or prototype keys show nothing", () => {
  assert.match(identityNotice("blocked"), /заблокирован/);
  assert.match(identityNotice("email_exists"), /привяжите Яндекс/);
  for (const code of [
    "",
    null,
    undefined,
    "nope",
    "__proto__",
    "constructor",
    "toString",
  ])
    assert.equal(identityNotice(code), null);
  assert.equal(identitySuccess("linked"), true);
  assert.equal(identitySuccess("taken"), false);
});
