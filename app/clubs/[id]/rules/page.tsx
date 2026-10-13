import Link from "next/link";
import { notFound } from "next/navigation";
import { currentUser } from "../../../../lib/auth.ts";
import { db } from "../../../../lib/db.ts";
import { clubDetail } from "../../../../lib/clubs.ts";
import { uuid } from "../../../../lib/validation.ts";
import { CommunityError } from "../../../../lib/community-validation.ts";
import RichTextBody from "../../../ui/rich-text-body.tsx";
import LocalDate from "../../../ui/local-date.tsx";
import styles from "../../../ui/clubs.module.css";
export const dynamic = "force-dynamic",
  runtime = "nodejs";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const id = (await params).id;
  if (!uuid.safeParse(id).success) notFound();
  const user = await currentUser();
  try {
    const c = await clubDetail(db, id, user?.id);
    return (
      <section className={styles.page}>
        <Link href={"/clubs/" + id}>{c.name}</Link>
        <h1>Правила клуба</h1>
        {c.rules ? (
          <RichTextBody doc={c.rulesDoc} />
        ) : (
          <p>
            Правила пока не опубликованы.
            {c.canManage ? " Добавьте их в управлении клубом." : ""}
          </p>
        )}
        {c.rulesUpdatedAt && (
          <p className={styles.meta}>
            Обновлено: <LocalDate value={c.rulesUpdatedAt} />
          </p>
        )}
        {c.canManage && (
          <Link
            className="button"
            href={"/clubs/" + id + "/manage?section=rules"}
          >
            Редактировать правила
          </Link>
        )}
      </section>
    );
  } catch (e) {
    if (e instanceof CommunityError && e.status === 404) notFound();
    throw e;
  }
}
