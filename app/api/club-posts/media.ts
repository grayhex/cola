import { db } from "../../../lib/db.ts";
import {
  clubPostPhotoFilename,
  readClubPostPhoto,
} from "../../../lib/club-post-storage.ts";
import {
  mediaWidth,
  mediaVariant,
  revalidatedMedia,
  mediaResponse,
  mediaEtag,
} from "../../../lib/media-cache.ts";
import { CommunityError } from "../../../lib/community-validation.ts";
// Both aliases share one HTTP representation and current ACL. Widths are the
// existing closed set; a cached derivative never supplies authorization.
export async function clubPostMedia(
  req: Request,
  club: string,
  post: string,
  photo: string,
  viewer: string | null,
) {
  const width = mediaWidth(new URL(req.url).searchParams.get("width"));
  if (width === undefined)
    throw new CommunityError("Неверный размер изображения");
  const authorize = () => clubPostPhotoFilename(db, club, post, photo, viewer);
  await authorize();
  const original = () => readClubPostPhoto(db, club, post, photo, viewer);
  return mediaResponse(
    await revalidatedMedia(
      () => (width ? mediaVariant(photo, width, original) : original()),
      authorize,
    ),
    mediaEtag(photo, width),
    { cache: "private, no-store" },
  );
}
