import { notFound } from "next/navigation";
import { currentUser } from "../../../../../lib/auth.ts";
import { db } from "../../../../../lib/db.ts";
import { clubDetail } from "../../../../../lib/clubs.ts";
import { uuid } from "../../../../../lib/validation.ts";
import { CommunityError } from "../../../../../lib/community-validation.ts";
import ClubPostEditor from "../../../../ui/club-post-editor.tsx";
export const dynamic = "force-dynamic",
  metadata = { title: "Написать в клуб · ColaBike", robots: { index: false } };
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const id = (await params).id;
  if (!uuid.safeParse(id).success) notFound();
  try {
    const user = await currentUser();
    return <ClubPostEditor club={await clubDetail(db, id, user?.id)} />;
  } catch (e) {
    if (e instanceof CommunityError && e.status === 404) notFound();
    throw e;
  }
}
