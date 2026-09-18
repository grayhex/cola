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
  return { mode: "production", origin: origin.origin, secureCookies: true };
}
