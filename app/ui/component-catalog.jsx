"use client";
import Link from "next/link";
import { SocialHeader, SocialFooter } from "./social-primitives.jsx";
import { useSite } from "./site-provider.jsx";
import PartIcon from "./part-icon.jsx";
import SiteIcon from "./site-icon.jsx";
import { plural } from "../../lib/plural.js";
import styles from "./component-catalog.module.css";

export default function ComponentCatalog({ data, filters }) {
  const { viewer, catalog } = useSite();
  const href = (next) =>
    "/components?" +
    new URLSearchParams(
      Object.entries({ ...filters, ...next }).filter(([, v]) => v !== ""),
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
              Модели деталей и опыт владельцев — в одном каталоге.
            </p>
          </div>
        </header>
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
                {[
                  ...new Set(
                    [...data.categories, filters.category].filter(Boolean),
                  ),
                ].map((c) => (
                  <option key={c}>{c}</option>
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
                : "По первому публичному появлению модели."}
            </p>
            {data.items.length ? (
              <ul className={styles.grid}>
                {data.items.map((m) => (
                  <li key={m.id} className={styles.card}>
                    <PartIcon
                      category={m.category}
                      icons={catalog.icons}
                      size={28}
                    />
                    <div>
                      <p className={styles.category}>
                        {m.category}
                        {m.brand ? " · " + m.brand : ""}
                      </p>
                      <h2>
                        <Link href={m.path}>{m.name}</Link>
                      </h2>
                      <p className={styles.count}>
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
