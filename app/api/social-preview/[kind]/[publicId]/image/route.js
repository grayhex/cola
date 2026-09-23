import { db } from '../../../../../../lib/db.js';
import { loadSocialPreview } from '../../../../../../lib/social-preview.js';
import { renderSocialImage } from '../../../../../../lib/social-preview-image.js';
export const runtime = 'nodejs', dynamic = 'force-dynamic';
export async function GET(req, { params }) {
  const { kind, publicId } = await params;
  if (!/^[a-z0-9]{6,8}$/.test(publicId)) return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  const preview = await loadSocialPreview(db, kind, publicId, { byPublicId: true });
  if (!preview) return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  const bytes = await renderSocialImage(preview);
  return new Response(bytes, { headers: {
    'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline',
  } });
}
