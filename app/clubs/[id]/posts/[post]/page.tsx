import { notFound } from "next/navigation";
import { currentUser } from "../../../../../lib/auth.ts";
import { db } from "../../../../../lib/db.ts";
import { clubPostDetail } from "../../../../../lib/club-posts.ts";
import { uuid } from "../../../../../lib/validation.ts";
import { CommunityError } from "../../../../../lib/community-validation.ts";
import { absolutePublicUrl } from "../../../../../lib/public-urls.ts";
import ClubPostReader from "../../../../ui/club-post-reader.tsx";
export const dynamic = "force-dynamic",
  runtime = "nodejs";
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string; post: string }>;
}) {
  const { id, post } = await params;
  if (!uuid.safeParse(id).success || !uuid.safeParse(post).success)
    return { title: "Публикация недоступна", robots: { index: false } };
  try {
    const p = await clubPostDetail(db, id, post);
    return {
      title: (p.title || "Публикация клуба") + " · " + p.club.name,
      description: p.excerpt,
      alternates: { canonical: absolutePublicUrl(p.href) },
      openGraph: {
        title: p.title || p.club.name,
        description: p.excerpt,
        url: absolutePublicUrl(p.href),
        images: p.photos.map((photo) => absolutePublicUrl(photo.url)),
      },
    };
  } catch (e) {
    if (e instanceof CommunityError)
      return { title: "Публикация недоступна", robots: { index: false } };
    throw e;
  }
}
export default async function Page({
  params,
}: {
  params: Promise<{ id: string; post: string }>;
}) {
  const { id, post } = await params;
  if (!uuid.safeParse(id).success || !uuid.safeParse(post).success) notFound();
  try {
    const user = await currentUser();
    return (
      <ClubPostReader initial={await clubPostDetail(db, id, post, user?.id)} />
    );
  } catch (e) {
    if (e instanceof CommunityError && e.status === 404) notFound();
    throw e;
  }
}
