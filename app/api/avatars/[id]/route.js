import { readFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../../../../lib/db.js";
import { uuid } from "../../../../lib/validation.js";
import { avatarFilename } from "../../../../lib/avatars.js";
import { fail } from "../../../../lib/http.js";
import { traced } from "../../../../lib/observability.js";
export const dynamic = "force-dynamic";
export const GET = traced(async (req, { params }) => {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return fail("Аватар недоступен", 404);
  const row = await db.query(
    "SELECT 1 FROM users WHERE avatar_id=$1 AND NOT blocked",
    [id],
  );
  if (!row.rowCount) return fail("Аватар недоступен", 404);
  try {
    return new Response(
      await readFile(
        path.join(process.env.UPLOAD_DIR || "uploads", avatarFilename(id)),
      ),
      {
        headers: {
          "Content-Type": "image/webp",
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch (e) {
    if (e.code === "ENOENT") return fail("Аватар недоступен", 404);
    throw e;
  }
});
