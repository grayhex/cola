import { errorCode } from "../../../../lib/errors.ts";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../../../../lib/db.ts";
import { uuid } from "../../../../lib/validation.ts";
import { avatarFilename } from "../../../../lib/avatars.ts";
import { fail } from "../../../../lib/http.ts";
import { traced } from "../../../../lib/observability.ts";
import {
  mediaEtag,
  mediaResponse,
  mediaVariant,
  mediaWidth,
  notModified,
  notModifiedResponse,
} from "../../../../lib/media-cache.ts";
export const dynamic = "force-dynamic";
export const GET = traced(
  async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    if (!uuid.safeParse(id).success) return fail("Аватар недоступен", 404);
    const width = mediaWidth(new URL(req.url).searchParams.get("width"));
    // Stored avatars are 512 px; larger variants would only waste the cache.
    if (width === undefined || (width !== null && width > 320))
      return fail("Неверный размер аватара");
    const row = await db.query<{ "?column?": number }>(
      "SELECT 1 FROM users WHERE avatar_id=$1 AND NOT blocked",
      [id],
    );
    if (!row.rowCount) return fail("Аватар недоступен", 404);
    const etag = mediaEtag("avatar-" + id, width);
    if (notModified(req, etag)) return notModifiedResponse(etag);
    try {
      const original = () =>
        readFile(
          /*turbopackIgnore: true*/
          path.join(
            /*turbopackIgnore: true*/ process.env.UPLOAD_DIR || "uploads",
            avatarFilename(id),
          ),
        );
      return mediaResponse(
        width
          ? await mediaVariant("avatar-" + id, width, original)
          : await original(),
        etag,
      );
    } catch (e) {
      if (errorCode(e) === "ENOENT") return fail("Аватар недоступен", 404);
      throw e;
    }
  },
);
