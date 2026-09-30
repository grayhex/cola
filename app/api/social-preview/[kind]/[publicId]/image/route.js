import { db } from "../../../../../../lib/db.ts";
import {
  isSocialKind,
  loadSocialPreview,
  loadSocialCard,
} from "../../../../../../lib/social-preview.ts";
import { renderSocialImage } from "../../../../../../lib/social-preview-image.ts";
export const runtime = "nodejs",
  dynamic = "force-dynamic";
/** @param {Request} req
 * @param {{ params: Promise<{ kind: string, publicId: string }> }} context */
export async function GET(req, { params }) {
  const { kind, publicId } = await params;
  if (!isSocialKind(kind) || !/^[a-z0-9]{6,8}$/.test(publicId))
    return new Response(null, {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  const preview = await loadSocialPreview(db, kind, publicId, {
    byPublicId: true,
  });
  const card = preview && (await loadSocialCard(db, preview));
  if (!card)
    return new Response(null, {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  const bytes = await renderSocialImage({ ...preview, card });
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    },
  });
}
