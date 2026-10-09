"use client";
import type * as React from "react";
import type {
  BikeDto,
  ViewerDto,
  SiteSettings,
  SiteCatalog,
  UserPreferences,
} from "../../../lib/contracts.ts";
import type { ModalSetter, MainElement } from "./types.ts";
import type { useShowcaseScroll } from "../showcase-scroll.ts";
import { AddBikeLink } from "../add-bike.tsx";
import { bikeCategories } from "../../../lib/bike-classification.ts";
import { ClassificationFilters } from "../bike-classification.tsx";
import styles from "../garage.module.css";
import ChoiceMenu from "../choice-menu.tsx";
import SiteIcon from "../site-icon.tsx";
import { FilterControl, FilterChips } from "../compact-ui.tsx";
import BikeGrid from "../bike-grid.tsx";
import BikeCard from "../bike-card.tsx";
import { Search } from "../icons.tsx";
import AccountSectionHead from "../account-section.tsx";

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
  openBike,
  auth,
  page,
}: {
  Main: MainElement;
  embedded: boolean;
  publicShowcase: boolean;
  rememberScroll: ReturnType<typeof useShowcaseScroll>;
  account: boolean;
  settings: Omit<SiteSettings, "componentsExpanded"> & UserPreferences;
  t: (text: string) => string;
  loading: boolean;
  total: number;
  sort: string | null;
  setSort: (value: string) => void;
  setPage: (value: React.SetStateAction<number>) => void;
  filters: string[];
  setFilters: (values: string[]) => void;
  user: ViewerDto | null;
  setModal: ModalSetter;
  categories: SiteCatalog["categories"];
  query: string;
  setQuery: (value: string) => void;
  facets: Record<string, string | null>;
  setFacets: (value: Record<string, string>) => void;
  updating: boolean;
  filtered: BikeDto[];
  openBike: (bike: BikeDto) => void;
  auth: (mode?: "login" | "register") => void;
  page: number;
}) {
  return (
    <>
      <Main
        className={`garage ${embedded ? "" : "page"} ${styles.garage}`}
        onClickCapture={publicShowcase ? rememberScroll : undefined}
      >
        {account && embedded ? (
          // «Мои велосипеды» shares the account section shell with «Мои
          // покатушки» (#245): title and count, primary action, toolbar.
          <AccountSectionHead
            title={t("Мои велосипеды")}
            count={!loading ? total : null}
            helper="Ваш гараж: публичные и приватные велосипеды, история и детали."
            action={
              user && (
                <button
                  type="button"
                  className="button add-bike"
                  onClick={() => setModal({ type: "bike" })}
                >
                  <SiteIcon name="add" />
                  {t("Добавить велосипед")}
                </button>
              )
            }
            toolbar={
              <FilterControl
                categories={bikeCategories}
                selected={filters}
                onChange={(values) => {
                  setFilters(values);
                  setPage(1);
                }}
              />
            }
          />
        ) : (
          // Datasets' title row: name, grey count, then the actions.
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
                <AddBikeLink
                  className="button add-bike"
                  aria-label={t("Добавить велосипед")}
                >
                  <SiteIcon name="add" />
                  <span className={styles.addLabel}>
                    {t("Добавить велосипед")}
                  </span>
                </AddBikeLink>
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
        )}
        {publicShowcase && !user && (
          <p className={styles.invitation}>
            {t("Твой байк тоже здесь к месту")} ·{" "}
            <AddBikeLink>
              {t("Покажи велосипед. Расскажи, что поменял")}
            </AddBikeLink>
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
        <BikeGrid>
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
