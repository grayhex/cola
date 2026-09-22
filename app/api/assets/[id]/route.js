import { assetContentSecurityPolicy } from "../../../../lib/asset-security.js";
import { db } from "../../../../lib/db.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { uuid } from "../../../../lib/validation.js";
import { fail } from "../../../../lib/http.js";
export const dynamic = "force-dynamic";
export async function GET(req, { params }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return fail("Изображение не найдено", 404);
  const { rows } = await db.query(
    "SELECT filename FROM site_assets WHERE id=$1",
    [id],
  );
  if (!rows[0]) return fail("Изображение не найдено", 404);
  try {
    return new Response(
      await readFile(
        path.join(process.env.UPLOAD_DIR || "uploads", rows[0].filename),
      ),
      {
        headers: {
          "Content-Type": rows[0].filename.endsWith(".svg")
            ? "image/svg+xml"
            : "image/webp",
          "Content-Security-Policy": assetContentSecurityPolicy,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch {
    return fail("Изображение не найдено", 404);
  }
}
