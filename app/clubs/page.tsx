import Image from "next/image";
import Link from "next/link";
import { currentUser } from "../../lib/auth.ts";
import { db } from "../../lib/db.ts";
import { clubList } from "../../lib/clubs.ts";
import styles from "../ui/clubs.module.css";
export const dynamic = "force-dynamic",
  runtime = "nodejs";
export const metadata = { title: "Клубы велосипедистов · ColaBike" };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const params = await searchParams,
    user = await currentUser(),
    page = Math.max(1, Math.min(10000, Number(params.page) || 1));
  const safePage = Number.isSafeInteger(page) ? page : 1;
  const data = await clubList(db, user?.id || null, {
    search: params.q,
    page: safePage,
  });
  return (
    <section className={styles.page}>
      <h1>Клубы велосипедистов</h1>
      <p>
        Компания для поездок и общения. У клуба может быть город или общая тема.
      </p>
      <div className={styles.actions}>
        <Link className="button" href="/clubs/new">
          Создать клуб
        </Link>
      </div>
      <form className={styles.actions}>
        <label>
          Найти клуб
          <input
            type="search"
            name="q"
            defaultValue={params.q || ""}
            maxLength={100}
            placeholder="Название или слоган"
          />
        </label>
        <button className="button">Найти</button>
      </form>
      {data.clubs.map((c) => (
        <article key={c.id} className={styles.identity}>
          {c.logo ? (
            <Image
              unoptimized
              width={512}
              height={512}
              className={styles.logo}
              src={c.logo}
              alt=""
              loading="lazy"
            />
          ) : (
            <span className={styles.logo} aria-hidden="true">
              {Array.from(c.name).slice(0, 2).join("").toUpperCase()}
            </span>
          )}
          <div>
            <h2>
              <Link href={"/clubs/" + c.id}>{c.name}</Link>
            </h2>
            <p>{c.slogan}</p>
            <p className={styles.meta}>
              {c.city && c.city + " · "}Участников: {c.memberCount}
            </p>
          </div>
        </article>
      ))}
      {!data.clubs.length && (
        <p>Клубов пока нет. Попробуйте другой запрос или создайте свой.</p>
      )}
      <nav className={styles.actions} aria-label="Страницы клубов">
        {safePage > 1 && (
          <Link
            className="button"
            href={
              "/clubs?q=" +
              encodeURIComponent(params.q || "") +
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
