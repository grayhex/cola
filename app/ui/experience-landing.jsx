"use client";
import Link from "next/link";
import { SocialHeader, SocialFooter } from "./social-primitives.jsx";
import { useSite } from "./site-provider.jsx";
import BikeCard from "./bike-card.jsx";
import BikeGrid from "./bike-grid.jsx";
import JournalCard from "./journal-card.jsx";
import { plural } from "../../lib/plural.js";
import styles from "./experience-landing.module.css";
import dynamic from "next/dynamic";
const ComponentGallery = dynamic(() => import("./component-gallery.jsx"));
const Discussion = dynamic(() => import("./discussion.jsx"), { ssr: false });

const count = (n, one, few, many) => `${n.toLocaleString("ru-RU")} ${plural(n, one, few, many)}`;

// A model or part page of owner experience (#74). The server passes the
// public data; nothing here is fetched again.
export default function ExperienceLanding({ data }) {
  const { viewer: user } = useSite();
  const model = data.kind === "model";
  const facts = [
    count(data.builds, "сборка", "сборки", "сборок"),
    ...(model
      ? data.types.map((type) =>
          data.types.length > 1 ? `${type.label}: ${type.builds}` : type.label,
        )
      : []),
    model && data.years.length &&
      (data.years[0] === data.years[1] ? `${data.years[0]} год` : `${data.years[0]}–${data.years[1]}`),
    model && data.weight && `в среднем ${data.weight.toLocaleString("ru-RU")} кг`,
    data.entryCount > 0 && count(data.entryCount, "запись", "записи", "записей"),
    model && data.rides > 0 &&
      `${count(data.rides, "покатушка", "покатушки", "покатушек")} · ${data.distanceKm.toLocaleString("ru-RU")} км`,
  ].filter(Boolean);
  return (
    <>
      <SocialHeader user={user} />
      <main className={`page experience-landing ${styles.page}`}>
        <header className={styles.head}>
          <p className={styles.eyebrow}>
            <Link href={model ? "/experience" : "/components"}>{model ? "Опыт владельцев" : "Компоненты"}</Link>
            {model ? " · модель" : " · " + data.category}
          </p>
          <h1>{data.title}</h1>
          {!model && data.brand && <p className="help">{data.brand}</p>}
          <ul className={styles.facts} aria-label="Коротко">
            {facts.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
          <p className={`help ${styles.note}`}>
            Реальные сборки и записи владельцев — их опыт, а не гарантия
            совместимости или безопасности.
          </p>
        </header>
        {!model && <ComponentGallery model={data} user={user} />}
        {model && data.parts.length > 0 && (
          <section className={styles.section} aria-labelledby="landing-parts">
            <h2 id="landing-parts">Частые детали в этих сборках</h2>
            <ul className={styles.links}>
              {data.parts.map((part) => (
                <li key={part.category + part.name}>
                  <Link href={part.path}>{part.name}</Link>
                  <span>
                    {part.category} · {count(part.builds, "сборка", "сборки", "сборок")}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {model && data.installs.length > 0 && (
          <section className={styles.section} aria-labelledby="landing-installs">
            <h2 id="landing-installs">Что ставили владельцы</h2>
            <ul className={styles.links}>
              {data.installs.map((part) => (
                <li key={part.category + part.name}>
                  <Link href={part.search}>{part.name}</Link>
                  <span>
                    {part.category} · {count(part.entries, "запись", "записи", "записей")}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {!model && data.models.length > 0 && (
          <section className={styles.section} aria-labelledby="landing-models">
            <h2 id="landing-models">На каких моделях стоит</h2>
            <ul className={styles.links}>
              {data.models.map((m) => (
                <li key={m.brand + m.model}>
                  <Link href={m.path}>
                    {m.brand} {m.model}
                  </Link>
                  <span>{count(m.builds, "сборка", "сборки", "сборок")}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        <section className={styles.section} aria-labelledby="landing-bikes">
          <h2 id="landing-bikes">Сборки владельцев</h2>
          {!data.bikes.length && <p className="help">Пока нет публичных сборок с этой моделью. Страница остаётся в каталоге.</p>}
          <BikeGrid>
            {data.bikes.map((bike) => (
              <BikeCard key={bike.id} bike={bike} user={user} />
            ))}
          </BikeGrid>
          {data.builds > data.bikes.length && (
            <p className={styles.more}>
              <Link href={data.search}>Все {count(data.builds, "сборка", "сборки", "сборок")} →</Link>
            </p>
          )}
        </section>
        {data.entries.length > 0 && (
          <section className={styles.section} aria-labelledby="landing-journal">
            <h2 id="landing-journal">Что пишут владельцы</h2>
            <div className="journal-feed">
              {data.entries.map((entry) => (
                <JournalCard key={entry.id} entry={entry} />
              ))}
            </div>
            {data.entryCount > data.entries.length && (
              <p className={styles.more}>
                <Link href={data.search + "&type=journal"}>
                  Все {count(data.entryCount, "запись", "записи", "записей")} →
                </Link>
              </p>
            )}
          </section>
        )}
        <p className={styles.more}>
          <Link href={data.search}>
            Расширенный поиск по {model ? "модели" : "детали"} →
          </Link>
        </p>
        {!model && <Discussion key={data.id} bike={data} user={user} entityType="component" />}
      </main>
      <SocialFooter />
    </>
  );
}
