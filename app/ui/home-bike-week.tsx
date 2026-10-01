import { useState } from "react";
import Link from "next/link";
import { Wrench } from "lucide-react";
import type { HomeSnapshot } from "./home.tsx";
import { publicPath } from "../../lib/public-urls.ts";
import { AuthorLink } from "./social-primitives.tsx";
import styles from "./home.module.css";
export default function BikeWeek({
  bike,
  loading,
}: {
  bike?: HomeSnapshot["bikeOfWeek"];
  loading: boolean;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!bike)
    return (
      <p className={styles.weekEmpty} role="status">
        {loading
          ? "Загружаем велосипед недели…"
          : bike === null
            ? "На этой неделе велосипед ещё не выбран. Знакомьтесь со сборками сообщества в витрине."
            : "Велосипед недели появится после загрузки."}
      </p>
    );
  const href = publicPath("bike", bike.bike),
    photo = `/api/photos/${bike.cover.id}`;
  return (
    <div className={styles.week}>
      <Link
        className={styles.weekPhoto}
        href={href}
        aria-label={"Велосипед недели: " + bike.bike.name}
      >
        {failed !== photo ? (
          <img
            src={photo + "?width=640"}
            srcSet={`${photo}?width=640 640w, ${photo}?width=1280 1280w`}
            sizes="(max-width: 720px) 100vw, 40vw"
            loading="lazy"
            decoding="async"
            alt={bike.bike.name}
            onError={() => setFailed(photo)}
          />
        ) : (
          <span className={styles.photoFallback}>Фото недоступно</span>
        )}
        <span className={styles.weekCaption}>
          <small>Выбор сообщества</small>
          <strong>{bike.bike.name}</strong>
        </span>
      </Link>
      <div className={styles.weekComponents}>
        <h3>Из чего собран</h3>
        <dl>
          {bike.components.map((c, i) => (
            <div key={i}>
              <dt>
                <Wrench size={14} aria-hidden="true" />
                {c.category}
              </dt>
              <dd>{c.name}</dd>
            </div>
          ))}
        </dl>
        <Link className="text-link" href={href}>
          Вся сборка <span aria-hidden="true">→</span>
        </Link>
      </div>
      <div className={styles.weekStory}>
        <h3>{bike.textSource === "owner" ? "От владельца" : "О велосипеде"}</h3>
        <AuthorLink author={bike.owner} />
        <p>{bike.text || "Владелец ещё не добавил описание."}</p>
        <Link className="text-link" href={href}>
          История велосипеда <span aria-hidden="true">→</span>
        </Link>
      </div>
    </div>
  );
}
