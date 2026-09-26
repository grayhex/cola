"use client";
import { ClassificationFilters } from "./bike-classification.jsx";
import {
  readClassificationFilters,
  classificationLabels,
} from "../../lib/bike-classification.js";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Bike, Route, Wrench, ArrowRight } from "lucide-react";
import { SocialHeader, SocialFooter } from "./social-primitives.jsx";
import { useSite } from "./site-provider.jsx";
import SearchBox from "./search-box.jsx";
import SmallImage from "./small-image.jsx";
import styles from "./discovery-search.module.css";
const tabs = [
  ["all", "Все"],
  ["bikes", "Велосипеды"],
  ["components", "Компоненты"],
  ["rides", "Покатушки"],
];
export default function DiscoverySearch() {
  const params = useSearchParams(),
    { viewer: user } = useSite(),
    [data, setData] = useState(null),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  const query = params.get("q") || params.get("component") || "",
    type = params.get("type") || "all",
    page = Math.max(1, Number(params.get("page")) || 1);
  const key = params.toString();
  const facets = {
    ...readClassificationFilters(params),
    category: params.get("category") || "",
  };
  const hasFacets = Object.values(facets).some(Boolean);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError("");
    fetch("/api/discovery/search?" + key, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        return d;
      })
      .then((d) => {
        if (!controller.signal.aborted) setData(d);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
  }, [key, revision]);
  function href(patch) {
    const next = new URLSearchParams(key);
    Object.entries(patch).forEach(([k, v]) => next.set(k, String(v)));
    return "/search?" + next;
  }
  return (
    <>
      <SocialHeader user={user} />
      <main className={styles.page}>
        <div className={styles.heading}>
          <h1>Поиск</h1>
          <Link href={"/experience?" + new URLSearchParams({ q: query })}>
            Расширенный поиск и опыт владельцев →
          </Link>
        </div>
        <SearchBox initialQuery={query} filters={{ ...facets, type }} />
        <ClassificationFilters
          withCategory
          value={facets}
          onChange={(next) => {
            const url = new URLSearchParams(key);
            Object.entries(next).forEach(([k, v]) =>
              v ? url.set(k, v) : url.delete(k),
            );
            url.delete("page");
            window.history.replaceState(null, "", "/search?" + url);
          }}
        />
        <nav className={styles.tabs} aria-label="Тип результатов">
          {tabs.map(([value, label]) => (
            <Link
              key={value}
              href={href({ type: value, page: 1 })}
              aria-current={type === value ? "page" : undefined}
            >
              {label}
            </Link>
          ))}
        </nav>
        {params.has("component") && (
          <p>
            Велосипеды с компонентом: <strong>{params.get("component")}</strong>
          </p>
        )}
        {error && (
          <p role="alert">
            {error}{" "}
            <button className="quiet" onClick={() => setRevision((v) => v + 1)}>
              Повторить
            </button>
          </p>
        )}
        {!data && !error && <p role="status">Ищем…</p>}
        {data && (
          <p className={styles.summary} role="status">
            {!query.trim() && !hasFacets
              ? "Введите название велосипеда, компонента или маршрута."
              : data.total
                ? `Найдено: ${data.total}`
                : "Ничего не найдено. Попробуйте другой запрос."}
          </p>
        )}
        {data?.groups.map((group) => (
          <section
            className={styles.group}
            key={group.type}
            aria-label={group.label}
          >
            <div className={styles.groupHeading}>
              <h2>
                {group.label} <span>{group.total}</span>
              </h2>
              {type === "all" && group.total > group.items.length && (
                <Link href={href({ type: group.type, page: 1 })}>
                  Все результаты →
                </Link>
              )}
            </div>
            {group.items.map((item) => {
              const Icon = { bike: Bike, component: Wrench, ride: Route }[
                item.type
              ];
              return (
                <Link key={item.id} href={item.href} className={styles.result}>
                  {item.type === "bike" ? (
                    <SmallImage src={item.image} className={styles.thumbnail} />
                  ) : (
                    <span className={styles.thumbnail}>
                      <Icon size={24} />
                    </span>
                  )}
                  <span className={styles.identity}>
                    <strong>{item.title}</strong>
                    <small>
                      {item.subtitle}
                      {item.metadata.category
                        ? " · " +
                          classificationLabels(item.metadata).join(" · ")
                        : ""}
                      {item.metadata.weight
                        ? " · " + Number(item.metadata.weight) + " кг"
                        : ""}
                      {item.metadata.distanceM != null
                        ? " · " +
                          (item.metadata.distanceM / 1000).toLocaleString(
                            "ru-RU",
                            { maximumFractionDigits: 1 },
                          ) +
                          " км"
                        : ""}
                    </small>
                  </span>
                  <ArrowRight size={16} />
                </Link>
              );
            })}
          </section>
        ))}
        {data && type !== "all" && data.total > data.pageSize && (
          <nav className={styles.pagination} aria-label="Страницы результатов">
            {page > 1 && <Link href={href({ page: page - 1 })}>← Назад</Link>}
            <span>
              {page} / {Math.ceil(data.total / data.pageSize)}
            </span>
            {page * data.pageSize < data.total && (
              <Link href={href({ page: page + 1 })}>Далее →</Link>
            )}
          </nav>
        )}
      </main>
      <SocialFooter />
    </>
  );
}
