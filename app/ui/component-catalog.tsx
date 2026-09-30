"use client";
import type { z } from "zod";
import type { componentCatalogInput } from "../../lib/component-catalog.ts";
import type { ComponentCatalogDto } from "../../lib/contracts.ts";
type Filters = z.infer<typeof componentCatalogInput>;

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { Bike, ArrowUpRight } from "lucide-react";
import { SocialHeader, SocialFooter } from "./social-primitives.tsx";
import { useSite } from "./site-provider.tsx";
import ComponentIllustration from "./component-illustration.tsx";
import SiteIcon from "./site-icon.tsx";
import { plural } from "../../lib/plural.ts";
import styles from "./component-catalog.module.css";
import ComponentNavigation from "./component-navigation.tsx";
import { componentNavigation } from "../../lib/component-navigation.ts";
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
  const href = (next: Partial<Filters>) =>
    "/components?" +
    new URLSearchParams(
      Object.entries({ ...filters, ...next })
        .filter(([, v]) => v !== "")
        .map(([key, value]) => [key, String(value)]),
    );
  const pages = Math.ceil(data.total / data.pageSize);
  const groups = componentNavigation(catalog, [
    ...data.categories,
    filters.category,
  ]);
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
        <ComponentNavigation
          key={filters.category}
          catalog={catalog}
          categories={data.categories}
          selected={filters.category}
        />
        <nav className="segmented" aria-label="Сортировка компонентов">
          <Link
            className={filters.sort === "popular" ? "active" : ""}
            aria-current={filters.sort === "popular" ? "page" : undefined}
            href={href({ sort: "popular", page: 1 })}
          >
            <SiteIcon name="popular" />
            Популярные
          </Link>
          <Link
            className={filters.sort === "new" ? "active" : ""}
            aria-current={filters.sort === "new" ? "page" : undefined}
            href={href({ sort: "new", page: 1 })}
          >
            <SiteIcon name="new" />
            Новые
          </Link>
        </nav>
        <div className={styles.layout}>
          <form
            className={styles.filters}
            action="/components"
            key={JSON.stringify(filters)}
            aria-label="Фильтры компонентов"
          >
            <input type="hidden" name="sort" value={filters.sort} />
            <label className="field">
              <span>Поиск модели</span>
              <input
                type="search"
                name="q"
                defaultValue={filters.q}
                maxLength={150}
                placeholder="Например, Brooks C17"
              />
            </label>
            <label className="field">
              <span>Категория</span>
              <select name="category" defaultValue={filters.category}>
                <option value="">Все категории</option>
                {groups.map((g) => (
                  <optgroup key={g.id} label={g.name}>
                    {g.categories.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Бренд</span>
              <select name="brand" defaultValue={filters.brand}>
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
              Показать
            </button>
            {(filters.q || filters.category || filters.brand) && (
              <Link
                className="quiet"
                href={href({ q: "", category: "", brand: "", page: 1 })}
              >
                Сбросить фильтры
              </Link>
            )}
          </form>
          <section aria-label="Модели компонентов" className={styles.results}>
            <p className="help">
              {filters.sort === "popular"
                ? "По числу публичных велосипедов с этой моделью."
                : "По первому публичному появлению модели."}{" "}
              Одна модель — одна карточка, независимо от места установки. Полная
              комплектация остаётся на странице велосипеда.
            </p>
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
      </main>
      <SocialFooter />
    </>
  );
}
