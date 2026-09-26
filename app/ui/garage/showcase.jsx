"use client";
import Link from "next/link";
import { bikeCategories } from "../../../lib/bike-classification.js";
import { ClassificationFilters } from "../bike-classification.jsx";
import styles from "../garage.module.css";
import ChoiceMenu from "../choice-menu.jsx";
import SiteIcon from "../site-icon.jsx";
import { FilterControl, FilterChips } from "../compact-ui.jsx";
import BikeGrid from "../bike-grid.jsx";
import BikeCard from "../bike-card.jsx";
import { Search } from "../icons.jsx";

export default function Showcase({
  Main,
  embedded,
  publicShowcase,
  rememberScroll,
  account,
  settings,
  t,
  loading,
  total,
  sort,
  setSort,
  setPage,
  filters,
  setFilters,
  user,
  setModal,
  categories,
  query,
  setQuery,
  facets,
  setFacets,
  updating,
  filtered,
  resultRevision,
  openBike,
  auth,
  page,
}) {
  return (
    <>
      <Main
        className={`garage ${embedded ? "" : "page"} ${styles.garage}`}
        onClickCapture={publicShowcase ? rememberScroll : undefined}
      >
        {/* Datasets' title row: name, grey count, then the actions. */}
        <div className={`garage-heading page-head ${styles.heading}`}>
          <div className="showcase-heading-copy page-title">
            <h1 className={styles.title}>
              {account
                ? t("Мои велосипеды")
                : t(settings.showcaseTitle || "Наши велосипеды")}
            </h1>
            {!loading && total > 0 && (
              <span className="count">{total.toLocaleString("ru-RU")}</span>
            )}
          </div>
          <div
            className={`showcase-actions page-actions ${styles.actions}`}
            aria-label={t("Действия витрины")}
          >
            {!account && (
              <ChoiceMenu
                label="Порядок витрины"
                value={sort}
                choices={[
                  { value: "new", label: "Новые", emoji: "new" },
                  {
                    value: "popular",
                    label: "Популярные",
                    emoji: "popular",
                  },
                  {
                    value: "records",
                    label: "Рекордсмены",
                    emoji: "records",
                  },
                ]}
                onChange={(value) => {
                  setSort(value);
                  setPage(1);
                }}
              />
            )}
            <FilterControl
              categories={bikeCategories}
              selected={filters}
              onChange={(values) => {
                setFilters(values);
                setPage(1);
              }}
            />
            {!account && (
              <Link
                className="button add-bike"
                href="/account?tab=bikes&action=add"
                aria-label={t("Добавить велосипед")}
              >
                <SiteIcon name="add" />
                <span className={styles.addLabel}>
                  {t("Добавить велосипед")}
                </span>
              </Link>
            )}
            {user && account && (
              <button
                type="button"
                className="button add-bike"
                aria-label="Добавить велосипед"
                title="Добавить велосипед"
                onClick={() => setModal({ type: "bike" })}
              >
                <SiteIcon name="add" />
                <span className={styles.addLabel}>
                  {t("Добавить велосипед")}
                </span>
              </button>
            )}
          </div>
        </div>
        {publicShowcase && !user && (
          <p className={styles.invitation}>
            {t("Твой байк тоже здесь к месту")} ·{" "}
            <Link href="/account?tab=bikes&action=add">
              {t("Покажи велосипед. Расскажи, что поменял")}
            </Link>
          </p>
        )}
        {account && !user && (
          <p>Войдите, чтобы управлять своими велосипедами и оформлением.</p>
        )}
        <FilterChips
          categories={categories}
          selected={filters}
          onChange={(values) => {
            setFilters(values);
            setPage(1);
          }}
          query={query}
          onClearSearch={() => {
            setQuery("");
            setPage(1);
          }}
        />
        <ClassificationFilters value={facets} onChange={setFacets} />
        <span className={styles.status} role="status">
          {loading
            ? t("Загружаем велосипеды…")
            : updating
              ? t("Обновляем велосипеды…")
              : ""}
        </span>
        <BikeGrid bikes={filtered} revision={resultRevision}>
          {loading &&
            [0, 1, 2].map((id) => (
              <div
                key={id}
                className={"skeleton " + styles.skeleton}
                aria-hidden="true"
              />
            ))}
          {filtered.map((b) => (
            <BikeCard
              key={b.id}
              bike={b}
              onOpen={account ? () => openBike(b) : undefined}
              user={user}
              onGuest={() => auth()}
              ownerView={account}
            />
          ))}
        </BikeGrid>
        {!account && total > 24 && (
          <nav className="pager" aria-label="Страницы витрины">
            <button
              className="button secondary small"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Назад
            </button>
            <span>
              {page} / {Math.ceil(total / 24)}
            </span>
            <button
              className="button secondary small"
              disabled={page * 24 >= total}
              onClick={() => setPage((p) => p + 1)}
            >
              Далее
            </button>
          </nav>
        )}
        {!loading && !filtered.length && !query && !filters.length && (
          <p className="empty-state">
            {account
              ? "Добавьте свой первый велосипед."
              : "Пока нет публичных велосипедов. Опубликуйте свой!"}
          </p>
        )}
        {!loading && !filtered.length && (query || filters.length > 0) && (
          <div className="empty-state">
            <Search aria-hidden="true" />
            <h3>{t("Таких велосипедов пока не нашли")}</h3>
            <button
              className="button secondary small"
              onClick={() => {
                setQuery("");
                setFilters([]);
              }}
            >
              {t("Сбросить фильтры")}
            </button>
          </div>
        )}
      </Main>
    </>
  );
}
