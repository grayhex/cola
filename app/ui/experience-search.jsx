"use client";
import { ClassificationFilters } from "./bike-classification.jsx";
import { readClassificationFilters } from "../../lib/bike-classification.js";
import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import {
  SocialHeader,
  SocialFooter,
  socialApi,
  Pagination,
  Avatar,
} from "./social-primitives.jsx";
import { useSite } from "./site-provider.jsx";
import BikeCard from "./bike-card.jsx";
import BikeGrid from "./bike-grid.jsx";
import JournalCard from "./journal-card.jsx";
import { CompactDialog } from "./compact-ui.jsx";
import { SlidersHorizontal } from "./icons.jsx";
import { profilePath } from "../../lib/public-urls.js";
import { personName, usernameLabel } from "../../lib/usernames.js";
const empty = {
  ...readClassificationFilters(new URLSearchParams()),
  category: "",
  q: "",
  brand: "",
  model: "",
  year: "",
  component: "",
  componentCategory: "",
  purpose: "",
  type: "bikes",
  kind: "",
  similar: "",
};
export default function ExperienceSearch({ modelPage = false }) {
  const params = useSearchParams(),
    { catalog, viewer: user } = useSite();
  const [form, setForm] = useState(empty),
    [query, setQuery] = useState(null),
    [data, setData] = useState(null),
    [error, setError] = useState(""),
    [filters, setFilters] = useState(false);
  useEffect(() => {
    const input = {
      ...empty,
      ...Object.fromEntries(params),
      ...(modelPage ? { exact: "1" } : {}),
    };
    setForm(input);
    setQuery(input);
  }, [params]);
  useEffect(() => {
    if (!query) return;
    let active = true;
    setData(null);
    setError("");
    socialApi("search?" + new URLSearchParams(query))
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [query, user?.id]);
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  function search(next) {
    if (modelPage) next = { ...next, exact: "1" };
    setForm(next);
    setQuery(next);
    history.replaceState(
      null,
      "",
      (modelPage ? "/experience" : "/search") +
        "?" +
        new URLSearchParams(Object.entries(next).filter(([, v]) => v !== "")),
    );
    setFilters(false);
  }
  const brands = [
      ...new Set(Object.values(catalog.models).flatMap((o) => Object.keys(o))),
    ],
    models = [
      ...new Set(
        Object.values(catalog.models).flatMap((o) => o[form.brand] || []),
      ),
    ],
    components = [...new Set(Object.values(catalog.parts).flat())];
  const title = modelPage
    ? form.component ||
      [form.brand, form.model].filter(Boolean).join(" ") ||
      "Опыт владельцев"
    : form.similar
      ? "Похожие сборки"
      : "Поиск";
  return (
    <>
      <SocialHeader user={user} />
      <main className="page experience-search">
        <div className="section-heading">
          <h1>{title}</h1>
          <button
            className="quiet"
            aria-label="Фильтры поиска"
            onClick={() => setFilters(true)}
          >
            <SlidersHorizontal size={16} />
            <span>Фильтры</span>
          </button>
        </div>
        {modelPage && (
          <p className="help">
            Реальные сборки, установки и вопросы владельцев. Количество
            материалов — свидетельства пользовательского опыта, не гарантия
            совместимости или безопасности.
          </p>
        )}
        <form
          className="experience-query"
          onSubmit={(e) => {
            e.preventDefault();
            search({ ...form, page: 1 });
          }}
        >
          <label className="field">
            <span>Велосипед, запись или владелец</span>
            <input
              type="search"
              maxLength={150}
              value={form.q}
              onChange={(e) => set("q", e.target.value)}
              placeholder="Название, деталь, решение…"
            />
          </label>
          <button className="button small">Найти</button>
        </form>
        <ClassificationFilters
          withCategory
          value={{
            ...readClassificationFilters(new URLSearchParams(form)),
            category: form.category || "",
          }}
          onChange={(v) => search({ ...form, ...v, page: 1 })}
        />
        <nav className="journal-modes ui-tabs" aria-label="Тип результатов">
          {[
            ["bikes", "Велосипеды"],
            ["journal", "Журнал"],
            ...(modelPage ? [] : [["users", "Пользователи"]]),
          ].map(([type, label]) => (
            <button
              className="quiet"
              key={type}
              aria-pressed={query?.type === type && !query.kind}
              onClick={() => search({ ...form, type, kind: "", page: 1 })}
            >
              {label}
            </button>
          ))}
          {modelPage && (
            <button
              className="quiet"
              aria-pressed={query?.kind === "question"}
              onClick={() =>
                search({ ...form, type: "journal", kind: "question", page: 1 })
              }
            >
              Вопросы
            </button>
          )}
        </nav>
        {form.type === "users" && (
          <p className="help">
            Поиск людей по имени и @username. Фильтры сборок к людям не
            применяются.
          </p>
        )}
        <div className="experience-chips filter-chips">
          {["brand", "model", "year", "component", "purpose", "similar"]
            .filter((k) => form[k])
            .map((k) => (
              <button
                key={k}
                className="quiet"
                aria-label={"Убрать фильтр " + k}
                onClick={() => search({ ...form, [k]: "", page: 1 })}
              >
                {k === "purpose"
                  ? catalog.purposes.find((p) => p.id === form[k])?.name ||
                    form[k]
                  : k === "similar"
                    ? "Похожие сборки"
                    : form[k]}{" "}
                ×
              </button>
            ))}
        </div>
        <CompactDialog
          open={filters}
          onClose={() => setFilters(false)}
          title="Фильтры поиска"
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              search({ ...form, page: 1 });
            }}
          >
            <div className="experience-filter-grid">
              {[
                ["brand", "Марка", brands],
                ["model", "Модель", models],
                ["component", "Компонент", components],
              ].map(([key, label, options]) => (
                <label className="field" key={key}>
                  <span>{label}</span>
                  <input
                    list={"search-" + key}
                    maxLength={150}
                    value={form[key]}
                    onChange={(e) => set(key, e.target.value)}
                  />
                  <datalist id={"search-" + key}>
                    {options.map((v) => (
                      <option key={v} value={v} />
                    ))}
                  </datalist>
                </label>
              ))}
              <label className="field">
                <span>Год</span>
                <input
                  type="number"
                  min="1900"
                  max="2100"
                  value={form.year}
                  onChange={(e) => set("year", e.target.value)}
                />
              </label>
              <label className="field">
                <span>Назначение</span>
                <select
                  aria-label="Назначение"
                  value={form.purpose}
                  onChange={(e) => set("purpose", e.target.value)}
                >
                  <option value="">Любое</option>
                  {catalog.purposes
                    .filter((p) => p.enabled || p.id === form.purpose)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            <div className="form-actions">
              <button className="button">Применить</button>
              <button
                type="button"
                className="quiet"
                onClick={() => search({ ...empty, q: form.q, type: form.type })}
              >
                Сбросить фильтры
              </button>
            </div>
          </form>
        </CompactDialog>
        {error && <p role="alert">{error}</p>}
        {!data && !error && <p role="status">Ищем…</p>}
        {data && (
          <>
            <p className="help">
              {modelPage ? "Публичных свидетельств" : "Найдено"}: {data.total}
            </p>
            {data.type === "bikes" ? (
              <BikeGrid bikes={data.items}>
                {data.items.map((b) => (
                  <BikeCard key={b.id} bike={b} user={user} />
                ))}
              </BikeGrid>
            ) : data.type === "journal" ? (
              <div className="journal-feed">
                {data.items.map((e) => (
                  <JournalCard key={e.id} entry={e} />
                ))}
              </div>
            ) : (
              <div className="experience-users">
                {data.items.map((u) => (
                  <a
                    className="person-identity"
                    href={profilePath(u.username)}
                    key={u.id}
                  >
                    <Avatar person={u} />
                    <span>
                      {personName(u)}
                      {usernameLabel(u) && " · " + usernameLabel(u)}
                    </span>
                  </a>
                ))}
              </div>
            )}
            {!data.items.length && (
              <section className="social-empty">
                <h2>Ничего не найдено</h2>
                <p>
                  Попробуйте другое написание или уберите часть фильтров.
                  Неизвестную модель можно указать свободным текстом при
                  добавлении велосипеда или детали.
                </p>
                <button
                  className="quiet"
                  onClick={() => search({ ...empty, type: form.type })}
                >
                  Сбросить поиск
                </button>
              </section>
            )}
            <Pagination
              {...data}
              onPage={(page) => search({ ...form, page })}
            />
          </>
        )}
      </main>
      <SocialFooter />
    </>
  );
}
