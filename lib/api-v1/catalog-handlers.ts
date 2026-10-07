import { createHash } from "node:crypto";
import { db } from "../db.ts";
import { notModified, notModifiedResponse } from "../media-cache.ts";
import { getSite } from "../site.ts";
import { ok, safely } from "./respond.ts";
import { toSiteCatalog } from "./wizard-mappers.ts";

// The dictionaries of the site for the native clients (#57 of the Android
// client). The same for everyone and readable without signing in, as the site's
// own `GET /api/site` is, so like the app configuration they may be cached: a
// minute fresh, then a conditional request answered 304 without a body.
export const siteCatalogCache = "public, max-age=60";

/** A strong validator of the exact answer: the code's dictionaries included. */
const catalogEtag = (body: unknown) =>
  `"site-catalog-${createHash("sha256")
    .update(JSON.stringify(body))
    .digest("base64url")
    .slice(0, 32)}"`;

/** GET /api/v1/catalog */
export function handleSiteCatalog(req: Request) {
  return safely(async () => {
    const catalog = toSiteCatalog(await getSite(db));
    const etag = catalogEtag(catalog);
    if (notModified(req, etag))
      return notModifiedResponse(etag, {
        cache: siteCatalogCache,
        headers: { "X-Content-Type-Options": "nosniff" },
      });
    return ok(catalog, 200, { "Cache-Control": siteCatalogCache, ETag: etag });
  });
}
