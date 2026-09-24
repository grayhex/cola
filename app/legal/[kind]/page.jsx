import { notFound } from "next/navigation";
import { db } from "../../../lib/db.js";
import { currentViewer } from "../../../lib/viewer.js";
import {
  legalKinds,
  legalTitles,
  publishedLegalDocument,
} from "../../../lib/legal-documents.js";
import GlobalHeader from "../../ui/global-header.jsx";
import { SocialFooter } from "../../ui/social-primitives.jsx";
import RichTextBody from "../../ui/rich-text-body.jsx";
import { indexed } from "../../../lib/indexing.js";
import styles from "./page.module.css";
export const dynamic = "force-dynamic";
export async function generateMetadata({ params, searchParams }) {
  const { kind } = await params;
  // Search engines index the current published revision only.
  const current =
    legalKinds.includes(kind) &&
    (await searchParams).revision === undefined &&
    (await publishedLegalDocument(db, kind));
  return {
    title: (legalTitles[kind] || "Документ") + " · ColaBike",
    ...(current && { robots: indexed }),
  };
}
export default async function Page({ params, searchParams }) {
  const { kind } = await params,
    search = await searchParams;
  if (!legalKinds.includes(kind)) notFound();
  if (
    search.revision !== undefined &&
    !/^[1-9][0-9]{0,8}$/.test(search.revision)
  )
    notFound();
  const document = await publishedLegalDocument(
    db,
    kind,
    search.revision ? Number(search.revision) : null,
  );
  if (search.revision && !document) notFound();
  return (
    <>
      <GlobalHeader user={await currentViewer()} />
      <main className={styles.page}>
        <h1>{legalTitles[kind]}</h1>
        {document ? (
          <>
            <p className={styles.version}>
              Редакция {document.revision} · Опубликовано{" "}
              <time dateTime={new Date(document.published_at).toISOString()}>
                {new Date(document.published_at).toLocaleDateString("ru-RU", {
                  timeZone: "UTC",
                })}
              </time>
            </p>
            <RichTextBody body={document.body} />
          </>
        ) : (
          <p>
            Документ ещё не опубликован. Регистрация будет доступна после
            публикации обоих документов.
          </p>
        )}
      </main>
      <SocialFooter />
    </>
  );
}
