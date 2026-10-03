import assert from "node:assert/strict";
import test from "node:test";
import {
  ANDROID_APP_ID,
  androidApplicationId,
  assetLinks,
  configuredFingerprints,
  normalizeFingerprint,
} from "../lib/android-app-links.ts";
import { nativeAuthReturnUrl, nativeReturn } from "../lib/native-auth.ts";
import { validateRuntime } from "../lib/runtime-config.ts";

const sha = (byte) => Array(32).fill(byte).join(":");
const A = sha("AA"),
  B = sha("0B");

test("fingerprints: SHA-256 as AA:BB:…, from hex too; anything else is refused", () => {
  assert.equal(normalizeFingerprint(A), A);
  assert.equal(normalizeFingerprint(A.toLowerCase()), A);
  assert.equal(normalizeFingerprint("aa".repeat(32)), A);
  assert.equal(normalizeFingerprint(" " + A + " "), A);
  for (const bad of [
    "",
    "AA:BB",
    "aa".repeat(31),
    "aa".repeat(33),
    "zz".repeat(32),
    Array(20).fill("AA").join(":"),
  ])
    assert.equal(normalizeFingerprint(bad), null, bad);
});

test("the statement lists the configured certificates and nothing is invented", () => {
  assert.deepEqual(assetLinks({}), [], "no fingerprint, no statement");
  assert.deepEqual(assetLinks({ ANDROID_CERT_SHA256: "  " }), []);
  const links = assetLinks({
    ANDROID_CERT_SHA256: `${A}, ${"0b".repeat(32)} ${A}`,
  });
  assert.deepEqual(links, [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: ANDROID_APP_ID,
        sha256_cert_fingerprints: [A, B],
      },
    },
  ]);
  assert.equal(ANDROID_APP_ID, "ru.colabike.app");
  assert.equal(
    assetLinks({
      ANDROID_CERT_SHA256: A,
      ANDROID_APP_ID: "ru.colabike.debug",
    })[0].target.package_name,
    "ru.colabike.debug",
  );
  // A name that is not a package falls back to the client's own.
  assert.equal(
    androidApplicationId({ ANDROID_APP_ID: "no spaces!" }),
    ANDROID_APP_ID,
  );
  assert.equal(androidApplicationId({}), ANDROID_APP_ID);
  assert.throws(() =>
    configuredFingerprints({ ANDROID_CERT_SHA256: A + ",oops" }),
  );
});

test("production startup refuses a fingerprint that is not SHA-256", () => {
  const production = {
    DEPLOYMENT_MODE: "production",
    POSTGRES_PASSWORD: "x7Kq-9vLm2Zr4Tn8Wp3Hs6Yd1Bc5Fg",
    APP_ORIGIN: "https://colabike.ru",
    COOKIE_SECURE: "true",
    TRUSTED_PROXY_KEY: "k".repeat(32),
    BIKE_RESOLVER_TOKEN: "t".repeat(32),
    DATABASE_URL: "postgres://u:p@db/cola",
    BIKE_RESOLVER_URL: "http://resolver:8080",
  };
  const attempt = (extra) => () => validateRuntime({ ...production, ...extra });
  assert.equal(validateRuntime(production).mode, "production");
  assert.doesNotThrow(attempt({ ANDROID_CERT_SHA256: A }));
  assert.doesNotThrow(attempt({ ANDROID_CERT_SHA256: `${A}, ${B}` }));
  assert.doesNotThrow(attempt({ ANDROID_CERT_SHA256: "aa".repeat(32) }));
  assert.throws(attempt({ ANDROID_CERT_SHA256: "abc" }), /ANDROID_CERT_SHA256/);
  assert.throws(
    attempt({ ANDROID_CERT_SHA256: `${A},oops` }),
    /ANDROID_CERT_SHA256/,
  );
});

test("the production return path is a valid App Link of the client", () => {
  const url = nativeAuthReturnUrl({
    NATIVE_AUTH_RETURN_URL: "https://colabike.ru/app/auth",
  });
  assert.ok(url);
  assert.equal(url.host, "colabike.ru");
  assert.equal(url.pathname, "/app/auth");
  assert.equal(
    nativeReturn(url, { code: "cola_ac_x" }).href,
    "https://colabike.ru/app/auth?code=cola_ac_x",
  );
});
