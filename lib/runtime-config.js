import { parseDsn } from "./error-tracker.js";
import { mailConfig } from "./mail.js";
export function validateRuntime(env = process.env) {
  if (env.DEPLOYMENT_MODE !== "production") return { mode: "local" };
  const reject = (message) => {
    throw new Error("Production configuration: " + message);
  };
  if (
    !env.POSTGRES_PASSWORD ||
    env.POSTGRES_PASSWORD.length < 24 ||
    /local|default|changeme|password|example/i.test(env.POSTGRES_PASSWORD)
  )
    reject(
      "POSTGRES_PASSWORD must be a non-default secret of at least 24 characters",
    );
  let origin;
  try {
    origin = new URL(env.APP_ORIGIN);
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
    } catch {}
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
    if (!mail || mail.options.ignoreTLS)
      reject(
        "SMTP_URL must be smtps://user:pass@host:465 or smtp://user:pass@host:587 (STARTTLS)",
      );
    if (!/@/.test(env.MAIL_FROM || ""))
      reject(
        'MAIL_FROM is required with SMTP_URL, e.g. "ColaBike <noreply@colabike.ru>"',
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
