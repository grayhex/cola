import { readFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../../../../lib/db.js";
import { uuid } from "../../../../lib/validation.js";
import { avatarFilename } from "../../../../lib/avatars.js";
import { fail } from "../../../../lib/http.js";
import { traced } from "../../../../lib/observability.js";
import {
  mediaEtag,
  mediaResponse,
  mediaVariant,
  mediaWidth,
  notModified,
  notModifiedResponse,
} from "../../../../lib/media-cache.js";
export const dynamic = "force-dynamic";
export const GET = traced(async (req, { params }) => {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return fail("Аватар недоступен", 404);
  const width = mediaWidth(new URL(req.url).searchParams.get("width"));
  // Stored avatars are 512 px; larger variants would only waste the cache.
  if (width === undefined || width > 320)
    return fail("Неверный размер аватара");
  const row = await db.query(
    "SELECT 1 FROM users WHERE avatar_id=$1 AND NOT blocked",
    [id],
  );
  if (!row.rowCount) return fail("Аватар недоступен", 404);
  const etag = mediaEtag("avatar-" + id, width);
  if (notModified(req, etag)) return notModifiedResponse(etag);
  try {
    const original = () =>
      readFile(
        path.join(process.env.UPLOAD_DIR || "uploads", avatarFilename(id)),
      );
    return mediaResponse(
      width ? await mediaVariant("avatar-" + id, width, original) : await original(),
      etag,
    );
  } catch (e) {
    if (e.code === "ENOENT") return fail("Аватар недоступен", 404);
    throw e;
  }
});
