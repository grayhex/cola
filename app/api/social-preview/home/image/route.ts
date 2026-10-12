import { mediaBusyResponse } from "../../../../../lib/media-cache.ts";
import { getSite } from "../../../../../lib/site.ts";
import { homePreview } from "../../../../../lib/social-metadata.ts";
import { renderSocialImage } from "../../../../../lib/social-preview-image.ts";
export const runtime = "nodejs",
  dynamic = "force-dynamic";
export async function GET() {
  const bytes = await (async () => {
    try {
      return await renderSocialImage(homePreview((await getSite()).settings));
    } catch (error) {
      const overloaded = mediaBusyResponse(error);
      if (overloaded) return overloaded;
      throw error;
    }
  })();
  if (bytes instanceof Response) return bytes;
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
