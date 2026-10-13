import { notFound } from "next/navigation";
import { currentUser } from "../../../lib/auth.ts";
import { db } from "../../../lib/db.ts";
import { clubDetail, clubPath } from "../../../lib/clubs.ts";
import { uuid } from "../../../lib/validation.ts";
import { CommunityError } from "../../../lib/community-validation.ts";
import { absolutePublicUrl } from "../../../lib/public-urls.ts";
import Link from "next/link";
import { clubPostList } from "../../../lib/club-posts.ts";
import ClubPostFeed from "../../ui/club-post-feed.tsx";
import ClubMembers from "../../ui/club-members.tsx";
import ClubHeader from "../../ui/club-header.tsx";
import styles from "../../ui/clubs.module.css";
export const dynamic = "force-dynamic",
  runtime = "nodejs";
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const id = (await params).id;
  if (!uuid.safeParse(id).success)
    return { title: "Клуб недоступен", robots: { index: false } };
  try {
    const c = await clubDetail(db, id),
      url = absolutePublicUrl(clubPath(id));
    return {
      title: c.name + " · Клуб · ColaBike",
      description: c.slogan,
      robots: { index: true, follow: true },
      alternates: { canonical: url },
      openGraph: {
        title: c.name,
        description: c.slogan,
        url,
        images: c.logo ? [absolutePublicUrl(c.logo)] : [],
      },
    };
  } catch (e) {
    if (e instanceof CommunityError)
      return { title: "Клуб недоступен", robots: { index: false } };
    throw e;
  }
}
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const id = (await params).id;
  if (!uuid.safeParse(id).success) notFound();
  const user = await currentUser();
  try {
    const club = await clubDetail(db, id, user?.id),
      tab = (await searchParams).tab,
      feed =
        tab !== "members" ? await clubPostList(db, id, user?.id || null) : null;
    return (
      <section className={styles.page}>
        <ClubHeader club={club} />
        <nav className={styles.actions} aria-label="Разделы клуба">
          <Link
            className="button secondary"
            href={"/clubs/" + id}
            aria-current={tab !== "members" ? "page" : undefined}
          >
            Лента
          </Link>
          <Link
            className="button secondary"
            href={"/clubs/" + id + "?tab=members"}
          >
            Участники
          </Link>
        </nav>
        {tab === "members" ? (
          <ClubMembers club={club} />
        ) : (
          feed && <ClubPostFeed club={club} initial={feed} />
        )}
      </section>
    );
  } catch (e) {
    if (e instanceof CommunityError && e.status === 404) notFound();
    throw e;
  }
}
