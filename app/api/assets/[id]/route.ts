import { assetContentSecurityPolicy } from "../../../../lib/asset-security.ts";
import { db } from "../../../../lib/db.ts";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { uuid } from "../../../../lib/validation.ts";
import { fail } from "../../../../lib/http.ts";
import { traced } from "../../../../lib/observability.ts";
import {
  immutableMediaCache,
  mediaEtag,
  mediaWidth,
  mediaVariant,
  mediaResponse,
  notModified,
  notModifiedResponse,
} from "../../../../lib/media-cache.ts";
export const dynamic = "force-dynamic";
// Site graphics are public and never rewritten in place: a new upload gets a
// new ID, so browsers may keep them for a year without revalidation.
export const GET = traced(
  async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    if (!uuid.safeParse(id).success) return fail("Изображение не найдено", 404);
    const { rows } = await db.query<{ filename: string }>(
      "SELECT filename FROM site_assets WHERE id=$1",
      [id],
    );
    if (!rows[0]) return fail("Изображение не найдено", 404);
    const requestedWidth = mediaWidth(
      new URL(req.url).searchParams.get("width"),
    );
    if (requestedWidth === undefined)
      return fail("Недопустимый размер изображения");
    // SVG retains its sanitizer/CSP and vector bytes; Rive is never rasterized.
    const raster = rows[0].filename.endsWith(".webp");
    const width = raster ? requestedWidth : null;
    const etag = mediaEtag("asset-" + id, width);
    const headers = { "Content-Security-Policy": assetContentSecurityPolicy };
    if (notModified(req, etag))
      return notModifiedResponse(etag, { cache: immutableMediaCache, headers });
    try {
      const original = () =>
        readFile(
          /*turbopackIgnore: true*/
          path.join(
            /*turbopackIgnore: true*/ process.env.UPLOAD_DIR || "uploads",
            rows[0].filename,
          ),
        );
      return mediaResponse(
        width
          ? await mediaVariant("asset-" + id, width, original)
          : await original(),
        etag,
        {
          cache: immutableMediaCache,
          contentType: rows[0].filename.endsWith(".riv")
            ? "application/octet-stream"
            : rows[0].filename.endsWith(".svg")
              ? "image/svg+xml"
              : "image/webp",
          headers,
        },
      );
    } catch {
      return fail("Изображение не найдено", 404);
    }
  },
);
