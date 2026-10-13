import { notFound } from "next/navigation";
import { currentUser } from "../../../../../../lib/auth.ts";
import { db } from "../../../../../../lib/db.ts";
import { clubDetail } from "../../../../../../lib/clubs.ts";
import { clubPostDetail } from "../../../../../../lib/club-posts.ts";
import { uuid } from "../../../../../../lib/validation.ts";
import { CommunityError } from "../../../../../../lib/community-validation.ts";
import ClubPostEditor from "../../../../../ui/club-post-editor.tsx";
export const dynamic = "force-dynamic",
  metadata = {
    title: "Редактировать публикацию · ColaBike",
    robots: { index: false },
  };
export default async function Page({
  params,
}: {
  params: Promise<{ id: string; post: string }>;
}) {
  const { id, post } = await params;
  if (!uuid.safeParse(id).success || !uuid.safeParse(post).success) notFound();
  try {
    const user = await currentUser(),
      record = await clubPostDetail(db, id, post, user?.id);
    return (
      <ClubPostEditor
        club={await clubDetail(db, id, user?.id)}
        initial={record}
      />
    );
  } catch (e) {
    if (e instanceof CommunityError && e.status === 404) notFound();
    throw e;
  }
}
