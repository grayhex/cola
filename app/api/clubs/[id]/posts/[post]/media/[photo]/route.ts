import { currentUser } from "../../../../../../../../lib/auth.ts";
import { uuid } from "../../../../../../../../lib/validation.ts";
import { CommunityError } from "../../../../../../../../lib/community-validation.ts";
import { clubPostMedia } from "../../../../../../club-posts/media.ts";
import { mediaBusyResponse } from "../../../../../../../../lib/media-cache.ts";
import { fail } from "../../../../../../../../lib/http.ts";
import { ZodError } from "zod";
export const runtime = "nodejs",
  dynamic = "force-dynamic";
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; post: string; photo: string }> },
) {
  try {
    const p = await params,
      user = await currentUser();
    return await clubPostMedia(
      req,
      uuid.parse(p.id),
      uuid.parse(p.post),
      uuid.parse(p.photo),
      user?.id || null,
    );
  } catch (e) {
    const busy = mediaBusyResponse(e);
    if (busy) return busy;
    if (e instanceof CommunityError) return fail(e.message, e.status);
    if (e instanceof ZodError) return fail("Изображение недоступно", 404);
    throw e;
  }
}
