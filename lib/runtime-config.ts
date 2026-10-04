import { cspMode, mapOrigins } from "./csp.ts";
import { parseDsn } from "./error-tracker.ts";
import { mailConfig } from "./mail.ts";
export function validateRuntime(env = process.env) {
  if (env.DEPLOYMENT_MODE !== "production") return { mode: "local" };
  function reject(message: string): never {
    throw new Error("Production configuration: " + message);
  }
  if (
    !env.POSTGRES_PASSWORD ||
    env.POSTGRES_PASSWORD.length < 24 ||
    /local|default|changeme|password|example/i.test(env.POSTGRES_PASSWORD)
  )
    reject(
      "POSTGRES_PASSWORD must be a non-default secret of at least 24 characters",
    );
  try {
    cspMode(env);
    mapOrigins(env.CSP_MAP_ORIGINS);
  } catch {
    reject("CSP_MODE or CSP_MAP_ORIGINS is invalid");
  }
  let origin;
  try {
    origin = new URL(env.APP_ORIGIN || "");
  } catch {
    reject("APP_ORIGIN must be an HTTPS origin");
  }
  if (
    origin.protocol !== "https:" ||
    origin.origin !== env.APP_ORIGIN ||
    ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)
  )
    reject("APP_ORIGIN must be a public HTTPS origin without path");
  if (env.COOKIE_SECURE !== "true") reject("COOKIE_SECURE must be true");
  if (!env.TRUSTED_PROXY_KEY || env.TRUSTED_PROXY_KEY.length < 32)
    reject("TRUSTED_PROXY_KEY must contain at least 32 random characters");
  if (!env.BIKE_RESOLVER_TOKEN || env.BIKE_RESOLVER_TOKEN.length < 32)
    reject("BIKE_RESOLVER_TOKEN must contain at least 32 random characters");
  if (!env.DATABASE_URL || !env.BIKE_RESOLVER_URL)
    reject("DATABASE_URL and BIKE_RESOLVER_URL are required");
  // Canonical and link-preview URLs are built from this origin on every page.
  if (env.PUBLIC_SITE_URL) {
    let site;
    try {
      site = new URL(env.PUBLIC_SITE_URL);
    } catch {
      /* Invalid site URLs are rejected below. */
    }
    if (
      site?.protocol !== "https:" ||
      site.origin !== env.PUBLIC_SITE_URL.replace(/\/$/, "") ||
      ["localhost", "127.0.0.1", "[::1]"].includes(site.hostname)
    )
      reject("PUBLIC_SITE_URL must be a public HTTPS origin without path");
  }
  if (env.ERROR_TRACKER_DSN && !parseDsn(env.ERROR_TRACKER_DSN)?.secure)
    reject("ERROR_TRACKER_DSN must be an HTTPS DSN like https://key@host/1");
  if (env.MAIL_CAPTURE_DIR)
    reject("MAIL_CAPTURE_DIR is for development and tests only");
  const mail = env.SMTP_URL ? mailConfig(env) : null;
  if (env.SMTP_URL) {
    if (!mail || mail.mode !== "smtp" || mail.options.ignoreTLS)
      reject(
        "SMTP_URL must be smtps://user:pass@host:465 or smtp://user:pass@host:587 (STARTTLS)",
      );
    if (!/@/.test(env.MAIL_FROM || ""))
      reject(
        'MAIL_FROM is required with SMTP_URL, e.g. "ColaBike <noreply@colabike.ru>"',
      );
  }
  // Yandex ID is optional; a half-filled configuration is a deployment error.
  // Kept here, not imported: the runner image ships only a few lib files for
  // the startup check (see the Dockerfile).
  if (
    env.YANDEX_ID_ENABLED === "true" &&
    !(env.YANDEX_ID_CLIENT_ID && env.YANDEX_ID_CLIENT_SECRET)
  )
    reject(
      "YANDEX_ID_CLIENT_ID and YANDEX_ID_CLIENT_SECRET are required when YANDEX_ID_ENABLED=true",
    );
  // The Android App Link statement (#324) is optional; a value that is not a
  // SHA-256 fingerprint would silently verify nothing. Kept inline, like the
  // check above, for the same reason.
  for (const part of (env.ANDROID_CERT_SHA256 || "")
    .split(/[\s,;]+/)
    .filter(Boolean))
    if (!/^(?:[0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2}$|^[0-9A-Fa-f]{64}$/.test(part))
      reject(
        "ANDROID_CERT_SHA256 must list SHA-256 fingerprints (AA:BB:… or 64 hex digits)",
      );
  // Push (#342) is optional; a half-filled configuration is a deployment error,
  // not a channel that silently sends nothing. Inline for the same reason as above.
  if (
    env.PUSH_TOKEN_KEY ||
    env.PUSH_TOKEN_KEY_PREVIOUS ||
    env.RUSTORE_PUSH_PROJECTS ||
    env.RUSTORE_PUSH_SERVICE_TOKEN
  ) {
    for (const name of ["PUSH_TOKEN_KEY", "PUSH_TOKEN_KEY_PREVIOUS"] as const)
      if (env[name] && Buffer.from(env[name].trim(), "base64").length !== 32)
        reject(
          `${name} must be 32 random bytes in base64 (openssl rand -base64 32)`,
        );
    if (
      !env.PUSH_TOKEN_KEY ||
      !(env.RUSTORE_PUSH_PROJECTS || "")
        .split(",")
        .some((project) => /^[A-Za-z0-9._-]{1,100}$/.test(project.trim()))
    )
      reject(
        "PUSH_TOKEN_KEY and RUSTORE_PUSH_PROJECTS (project ids, comma-separated) are required together with any other push setting",
      );
  }
  // Mail is optional, but without it password recovery is unavailable: log it.
  return {
    mode: "production",
    origin: origin.origin,
    secureCookies: true,
    mail: mail ? "smtp" : "disabled",
  };
}
