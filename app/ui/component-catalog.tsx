"use client";
import type { z } from "zod";
import type { componentCatalogInput } from "../../lib/component-catalog.ts";
import type { ComponentCatalogDto } from "../../lib/contracts.ts";
type Filters = z.infer<typeof componentCatalogInput>;

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState, useTransition } from "react";
import { Bike, ArrowUpRight } from "lucide-react";
import { SocialHeader, SocialFooter } from "./social-primitives.tsx";
import { useSite } from "./site-provider.tsx";
import ComponentIllustration from "./component-illustration.tsx";
import SiteIcon from "./site-icon.tsx";
import { plural } from "../../lib/plural.ts";
import styles from "./component-catalog.module.css";
import ComponentNavigation from "./component-navigation.tsx";
import { useRouter } from "next/navigation";
import { SharedView } from "./motion.tsx";

function ComponentCover({
  model,
  icons,
}: {
  model: ComponentCatalogDto["items"][number];
  icons: Record<string, string>;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={styles.cover}>
      {model.coverUrl && !failed ? (
        <Image
          className={styles.photo}
          width={640}
          height={400}
          unoptimized
          src={model.coverUrl + "?width=640"}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <ComponentIllustration
          category={model.category}
          icons={icons}
          size={88}
        />
      )}
    </div>
  );
}

export default function ComponentCatalog({
  data,
  filters,
}: {
  data: ComponentCatalogDto;
  filters: Filters;
}) {
  const { viewer, catalog } = useSite();
  const router = useRouter();
  const [query, setQuery] = useState(filters.q);
  const [brand, setBrand] = useState(filters.brand);
  const [pending, startTransition] = useTransition();
  useEffect(() => setQuery(filters.q), [filters.q]);
  useEffect(() => setBrand(filters.brand), [filters.brand]);
  const navigate = (next: Partial<Filters>) =>
    startTransition(() => router.push(href(next), { scroll: false }));
  const href = (next: Partial<Filters>) =>
    "/components?" +
    new URLSearchParams(
      Object.entries({ ...filters, brand, ...next })
        .filter(([, v]) => v !== "")
        .map(([key, value]) => [key, String(value)]),
    );
  const pages = Math.ceil(data.total / data.pageSize);
  return (
    <>
      <SocialHeader user={viewer} />
      <main className={`page ${styles.page}`}>
        <header className="page-head">
          <div>
            <h1 className="page-title">
              Компоненты <span className="count">{data.total}</span>
            </h1>
            <p className="help">
              Продуктовые модели, сборки и опыт владельцев.
            </p>
          </div>
        </header>
        <div className={styles.layout}>
          <ComponentNavigation
            catalog={catalog}
            categories={data.categories}
            selected={filters.category}
            href={(category) => href({ category, page: 1 })}
          />
          <div className={styles.content} aria-busy={pending}>
            <form
              className={styles.filters}
              action="/components"
              aria-label="Фильтры компонентов"
              onSubmit={(e) => {
                e.preventDefault();
                navigate({ q: query, brand, page: 1 });
              }}
            >
              <input type="hidden" name="sort" value={filters.sort} />
              <input type="hidden" name="category" value={filters.category} />
              <label className="field">
                <span>Поиск модели</span>
                <input
                  type="search"
                  name="q"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  maxLength={150}
                  placeholder="Например, Brooks C17"
                />
              </label>
              <label className="field">
                <span>Бренд</span>
                <select
                  name="brand"
                  value={brand}
                  onChange={(e) => {
                    setBrand(e.target.value);
                    navigate({ brand: e.target.value, page: 1 });
                  }}
                >
                  <option value="">Все бренды</option>
                  {[
                    ...new Set([...data.brands, filters.brand].filter(Boolean)),
                  ].map((b) => (
                    <option key={b}>{b}</option>
                  ))}
                </select>
              </label>
              <button className="button secondary" type="submit">
                <SiteIcon name="filters" />
                Найти
              </button>
              <div className={styles.toolbarMeta}>
                <nav className="segmented" aria-label="Сортировка компонентов">
                  <Link
                    className={filters.sort === "popular" ? "active" : ""}
                    aria-current={
                      filters.sort === "popular" ? "page" : undefined
                    }
                    href={href({ sort: "popular", page: 1 })}
                    scroll={false}
                  >
                    Популярные
                  </Link>
                  <Link
                    className={filters.sort === "new" ? "active" : ""}
                    aria-current={filters.sort === "new" ? "page" : undefined}
                    href={href({ sort: "new", page: 1 })}
                    scroll={false}
                  >
                    Новые
                  </Link>
                </nav>
                {(filters.q || filters.category || filters.brand || query) && (
                  <Link
                    className="quiet"
                    href={href({
                      q: "",
                      category: "",
                      brand: "",
                      sort: "popular",
                      page: 1,
                    })}
                    scroll={false}
                    onClick={() => {
                      setQuery("");
                      setBrand("");
                    }}
                  >
                    Сбросить фильтры
                  </Link>
                )}
                <p className={styles.resultInfo}>
                  {filters.category || "Все компоненты"} · {data.total}{" "}
                  {plural(data.total, "модель", "модели", "моделей")}
                  {pending ? " · Обновляем…" : ""}
                </p>
              </div>
            </form>
            <section aria-label="Модели компонентов" className={styles.results}>
              {data.items.length ? (
                <ul className={styles.grid}>
                  {data.items.map((m) => (
                    <li key={m.id} className={styles.card}>
                      <ComponentCover
                        key={m.coverUrl}
                        model={m}
                        icons={catalog.icons}
                      />
                      <div className={styles.cardBody}>
                        <p className={styles.category}>
                          {m.category}
                          {m.brand ? " · " + m.brand : ""}
                        </p>
                        <SharedView kind="component" id={m.id}>
                          <h2>
                            <Link href={m.path}>
                              {m.name}
                              <ArrowUpRight size={16} aria-hidden="true" />
                            </Link>
                          </h2>
                        </SharedView>
                        <p className={styles.count}>
                          <Bike size={16} aria-hidden="true" />
                          {m.builds}{" "}
                          {plural(m.builds, "сборка", "сборки", "сборок")}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="empty">
                  <h2>Модели не найдены</h2>
                  <p>Измените фильтры или откройте весь каталог.</p>
                  <Link href="/components">Все компоненты</Link>
                </div>
              )}
              {pages > 1 && (
                <nav className="pager" aria-label="Страницы">
                  {data.page > 1 && (
                    <Link
                      className="button secondary small"
                      href={href({ page: data.page - 1 })}
                    >
                      Назад
                    </Link>
                  )}
                  <span>
                    {data.page} / {pages}
                  </span>
                  {data.page < pages && (
                    <Link
                      className="button secondary small"
                      href={href({ page: data.page + 1 })}
                    >
                      Далее
                    </Link>
                  )}
                </nav>
              )}
            </section>
          </div>
        </div>
      </main>
      <SocialFooter />
    </>
  );
}
