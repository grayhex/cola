import { notFound } from "next/navigation";
import Link from "next/link";
import { currentUser } from "../../../../lib/auth.ts";
import { db } from "../../../../lib/db.ts";
import { clubDetail } from "../../../../lib/clubs.ts";
import { uuid } from "../../../../lib/validation.ts";
import { CommunityError } from "../../../../lib/community-validation.ts";
import ClubEditor from "../../../ui/club-editor.tsx";
export const dynamic = "force-dynamic",
  runtime = "nodejs";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ section?: string }>;
}) {
  const id = (await params).id;
  if (!uuid.safeParse(id).success) notFound();
  const user = await currentUser();
  if (!user)
    return (
      <section className="empty-state">
        <h1>Войдите для управления клубом</h1>
        <Link
          className="button"
          href={"/login?next=" + encodeURIComponent("/clubs/" + id + "/manage")}
        >
          Войти
        </Link>
      </section>
    );
  try {
    const c = await clubDetail(db, id, user.id);
    if (!c.canManage) notFound();
    return (
      <ClubEditor
        initial={c}
        rulesOnly={(await searchParams).section === "rules"}
      />
    );
  } catch (e) {
    if (e instanceof CommunityError && e.status === 404) notFound();
    throw e;
  }
}
