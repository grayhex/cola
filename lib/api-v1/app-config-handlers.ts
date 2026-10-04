import { db } from "../db.ts";
import { notModified, notModifiedResponse } from "../media-cache.ts";
import { appConfig, appConfigEtag } from "../mobile-settings.ts";
import { ok, safely } from "./respond.ts";

// The settings of the native apps (#338). The same for everyone and readable
// without signing in, so unlike the rest of API v1 the answer may be cached:
// a minute fresh, then a conditional request answered 304 without a body.
export const appConfigCache = "public, max-age=60";

/** GET /api/v1/app-config */
export function handleAppConfig(req: Request) {
  return safely(async () => {
    const config = await appConfig(db);
    const etag = appConfigEtag(config);
    if (notModified(req, etag))
      return notModifiedResponse(etag, {
        cache: appConfigCache,
        headers: { "X-Content-Type-Options": "nosniff" },
      });
    return ok(config, 200, { "Cache-Control": appConfigCache, ETag: etag });
  });
}
