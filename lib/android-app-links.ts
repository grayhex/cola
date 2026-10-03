// Digital Asset Links for the Android application (#324): the statement that
// lets the system verify the HTTPS App Link of native sign-in
// (NATIVE_AUTH_RETURN_URL, https://colabike.ru/app/auth in production) as ours.
// The certificate fingerprints are the operator's: ANDROID_CERT_SHA256 holds the
// SHA-256 of the signing certificate(s), a debug one next to the release one if
// needed. A private key is never involved, and none is invented here: without a
// fingerprint the statement list is empty and no link is verified.

/** The applicationId of the client (#325). */
export const ANDROID_APP_ID = "ru.colabike.app";

const packagePattern = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/i;
const fingerprintPattern = /^[0-9A-F]{2}(?::[0-9A-F]{2}){31}$/;

/**
 * One fingerprint as the file spells it (`AA:BB:…`, 32 bytes), or null for text
 * that is not a SHA-256: a mistake must not silently verify nothing.
 */
export function normalizeFingerprint(value: string): string | null {
  const text = value.trim().toUpperCase();
  const bytes = /^[0-9A-F]{64}$/.test(text)
    ? text.match(/../g)!.join(":")
    : text;
  return fingerprintPattern.test(bytes) ? bytes : null;
}

/** The fingerprints of the variable, split on commas and white space. */
export function configuredFingerprints(env = process.env): string[] {
  const fingerprints: string[] = [];
  for (const part of (env.ANDROID_CERT_SHA256 || "")
    .split(/[\s,;]+/)
    .filter(Boolean)) {
    const fingerprint = normalizeFingerprint(part);
    if (!fingerprint)
      throw new Error("ANDROID_CERT_SHA256 holds a value that is not SHA-256");
    if (!fingerprints.includes(fingerprint)) fingerprints.push(fingerprint);
  }
  return fingerprints;
}

export function androidApplicationId(env = process.env): string {
  const id = (env.ANDROID_APP_ID || "").trim();
  return packagePattern.test(id) ? id : ANDROID_APP_ID;
}

/** The body of `/.well-known/assetlinks.json`. */
export function assetLinks(env = process.env) {
  const fingerprints = configuredFingerprints(env);
  if (!fingerprints.length) return [];
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: androidApplicationId(env),
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];
}
