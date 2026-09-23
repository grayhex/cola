import { assetContentSecurityPolicy } from "../../../../lib/asset-security.js";
import { db } from "../../../../lib/db.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { uuid } from "../../../../lib/validation.js";
import { fail } from "../../../../lib/http.js";
import { traced } from "../../../../lib/observability.js";
import {
  immutableMediaCache,
  mediaEtag,
  mediaResponse,
  notModified,
  notModifiedResponse,
} from "../../../../lib/media-cache.js";
export const dynamic = "force-dynamic";
// Site graphics are public and never rewritten in place: a new upload gets a
// new ID, so browsers may keep them for a year without revalidation.
export const GET = traced(async (req, { params }) => {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return fail("Изображение не найдено", 404);
  const { rows } = await db.query(
    "SELECT filename FROM site_assets WHERE id=$1",
    [id],
  );
  if (!rows[0]) return fail("Изображение не найдено", 404);
  const etag = mediaEtag("asset-" + id);
  const headers = { "Content-Security-Policy": assetContentSecurityPolicy };
  if (notModified(req, etag))
    return notModifiedResponse(etag, { cache: immutableMediaCache, headers });
  try {
    return mediaResponse(
      await readFile(
        path.join(process.env.UPLOAD_DIR || "uploads", rows[0].filename),
      ),
      etag,
      {
        cache: immutableMediaCache,
        contentType: rows[0].filename.endsWith(".svg")
          ? "image/svg+xml"
          : "image/webp",
        headers,
      },
    );
  } catch {
    return fail("Изображение не найдено", 404);
  }
});
