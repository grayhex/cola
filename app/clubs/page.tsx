import ClubCard from "../ui/club-card.tsx";
import ClubFilters from "../ui/club-filters.tsx";
import Link from "next/link";
import { currentUser } from "../../lib/auth.ts";
import { db } from "../../lib/db.ts";
import { clubList } from "../../lib/clubs.ts";
import styles from "../ui/clubs.module.css";
export const dynamic = "force-dynamic",
  runtime = "nodejs";
export const metadata = {
  title: "Клубы велосипедистов · ColaBike",
  robots: { index: true, follow: true },
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    page?: string;
    city?: string;
    format?: string;
  }>;
}) {
  const params = await searchParams,
    user = await currentUser(),
    page = Math.max(1, Math.min(10000, Number(params.page) || 1));
  const safePage = Number.isSafeInteger(page) ? page : 1;
  const data = await clubList(db, user?.id || null, {
    city: params.city,
    format: params.format,
    search: params.q,
    page: safePage,
  });
  return (
    <section className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <h1>Клубы велосипедистов</h1>
          <p className={styles.meta}>
            Компания для поездок и общения — в вашем городе или по общей теме.
          </p>
        </div>
        <Link className="button" href="/clubs/new">
          Создать клуб
        </Link>
      </header>
      <ClubFilters
        key={JSON.stringify([params.q, params.city, params.format])}
        search={params.q || ""}
        city={params.city || ""}
        format={params.format || ""}
      />
      <div className={styles.clubList}>
        {data.clubs.map((c) => (
          <ClubCard key={c.id} club={c} />
        ))}
      </div>
      {!data.clubs.length && (
        <div className={styles.empty}>
          <h2>
            {safePage > 1
              ? "На этой странице клубов нет"
              : params.q || params.city || params.format
                ? "Ничего не найдено"
                : "Здесь появятся ваши клубы"}
          </h2>
          <p>
            {safePage > 1
              ? "Вернитесь к началу списка."
              : params.q || params.city || params.format
                ? "Попробуйте другой запрос или уберите фильтры."
                : "Создайте клуб, чтобы собираться на покатушки и общаться."}
          </p>
          <Link
            className="button secondary"
            href={
              safePage > 1
                ? "/clubs?" +
                  new URLSearchParams({
                    q: params.q || "",
                    city: params.city || "",
                    format: params.format || "",
                  })
                : params.q || params.city || params.format
                  ? "/clubs"
                  : "/clubs/new"
            }
          >
            {safePage > 1
              ? "К первой странице"
              : params.q || params.city || params.format
                ? "Сбросить фильтры"
                : "Создать первый клуб"}
          </Link>
        </div>
      )}
      <nav className={styles.actions} aria-label="Страницы клубов">
        {safePage > 1 && (
          <Link
            className="button"
            href={
              "/clubs?q=" +
              encodeURIComponent(params.q || "") +
              "&city=" +
              encodeURIComponent(params.city || "") +
              "&format=" +
              encodeURIComponent(params.format || "") +
              "&page=" +
              (safePage - 1)
            }
          >
            Назад
          </Link>
        )}
        {data.hasMore && (
          <Link
            className="button"
            href={
              "/clubs?q=" +
              encodeURIComponent(params.q || "") +
              "&city=" +
              encodeURIComponent(params.city || "") +
              "&format=" +
              encodeURIComponent(params.format || "") +
              "&page=" +
              (safePage + 1)
            }
          >
            Дальше
          </Link>
        )}
      </nav>
    </section>
  );
}
