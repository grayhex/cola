"use client";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { useSite } from "../ui/site-provider.tsx";
import RideCreationActions from "../ui/ride-creation-actions.jsx";
import RideList from "../ui/ride-list.jsx";
import { CompactDialog } from "../ui/compact-ui.tsx";
import SiteIcon from "../ui/site-icon.tsx";
import { SocialHeader, SocialFooter } from "../ui/social-primitives.tsx";
import { ridePlanOptions } from "../../lib/ride-plan-options.ts";
import {
  datePresets,
  durationBuckets,
  filterLabels,
  readFilters,
} from "../../lib/ride-filters.ts";
import { readOrganize } from "../../lib/organize-filters.ts";

// «Собрать компанию» (#234) loads only when a signed-in organizer opens it.
const OrganizeWorkspace = dynamic(
  () => import("../ui/organize-workspace.jsx"),
  {
    ssr: false,
    loading: () => <p role="status">Открываем…</p>,
  },
);

// Only shared public filters reach the URL (#233): shareable, restorable on
// back/forward, never a personal schedule, identity or coordinates.
function writeUrl(status, filters, bikeId) {
  // Rebuilt from allowed keys only: nothing else survives from a pasted URL.
  const url = new URL(location.pathname, location.origin);
  if (status) url.searchParams.set("status", status);
  if (status === "planned")
    for (const [key, value] of Object.entries(filters))
      url.searchParams.set(key, value);
  if (bikeId) url.searchParams.set("bikeId", bikeId);
  window.history.replaceState(null, "", url);
}
function FilterFields({ value, onChange, idPrefix }) {
  // An updater, not a copy of `value`: two quick changes before React
  // re-renders (a pending list transition) must not drop the first one.
  const set = (key, v) =>
    onChange((prev) => {
      const next = { ...prev };
      if (!v) delete next[key];
      else next[key] = v;
      return next;
    });
  const select = (key, label, options) => (
    <label className="field" key={key}>
      <span>{label}</span>
      <select
        value={value[key] || ""}
        onChange={(e) => set(key, e.target.value)}
      >
        <option value="">Любой</option>
        {Object.entries(options).map(([v, text]) => (
          <option key={v} value={v}>
            {Array.isArray(text) ? text[0] : text}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <>
      <fieldset className="filter-group">
        <legend>Когда</legend>
        <div className="segmented" role="group" aria-label="Когда">
          <button
            type="button"
            aria-pressed={!value.when}
            onClick={() => set("when", "")}
          >
            Все даты
          </button>
          {Object.entries(datePresets).map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={value.when === key}
              onClick={() => set("when", key)}
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="ride-filter-fields">
        {select("pace", "Темп", ridePlanOptions.pace)}
        {select("purpose", "Цель", ridePlanOptions.purpose)}
        {select("surface", "Покрытие", ridePlanOptions.surface)}
        {select("duration", "Длительность", durationBuckets)}
        <label className="field">
          <span>Район или парк</span>
          <input
            id={idPrefix + "-area"}
            type="search"
            maxLength={100}
            placeholder="Например, Сокольники"
            value={value.area || ""}
            onChange={(e) => set("area", e.target.value)}
          />
        </label>
      </div>
    </>
  );
}
// The organizer's shared choices only — never a schedule or a person.
function writeOrganizeUrl(filters) {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set("mode", "organize");
  for (const [key, value] of Object.entries(filters))
    if (value) url.searchParams.set(key, value);
  window.history.replaceState(null, "", url);
}
export default function Rides() {
  const { viewer: user } = useSite();
  const [bikeId, setBikeId] = useState(null),
    [organize, setOrganize] = useState(null),
    [status, setStatus] = useState(null),
    [filters, setFilters] = useState({}),
    [area, setArea] = useState(""),
    [sheet, setSheet] = useState(false),
    [draft, setDraft] = useState({});
  // The newest filter set, ahead of the next render.
  const latest = useRef({});
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const initial = readFilters(params);
    if (params.get("mode") === "organize") setOrganize(readOrganize(params));
    setBikeId(params.get("bikeId") || "");
    setStatus(
      ["planned", "completed"].includes(params.get("status"))
        ? params.get("status")
        : null,
    );
    latest.current = initial;
    setFilters(initial);
    setArea(initial.area || "");
  }, []);
  // Choices apply at once; a typed district waits for a pause. The applied
  // set is derived, so no timer can leave it behind the visible controls.
  // The URL is written in the same event: a late remount after back/forward
  // re-reads it and cannot drop a choice that has not reached it yet.
  const url = (nextStatus, nextFilters, typed) => {
    if (bikeId === null) return;
    const { area: _typed, ...rest } = nextFilters;
    void _typed;
    writeUrl(
      nextStatus,
      nextStatus === "planned" ? (typed ? { ...rest, area: typed } : rest) : {},
      bikeId,
    );
  };
  // Any other change (a filter, the tab) restarts the pause, so the delayed
  // write always carries the current status and filter set.
  useEffect(() => {
    const next = filters.area || "";
    if (next === area) return;
    const timer = setTimeout(() => {
      setArea(next);
      url(status, filters, next);
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `url` only reads bikeId
  }, [filters, area, status]);
  const applied = useMemo(() => {
    const { area: typed, ...rest } = filters;
    void typed;
    return area ? { ...rest, area } : rest;
  }, [filters, area]);
  function change(update, typed = area) {
    const next = typeof update === "function" ? update(latest.current) : update;
    latest.current = next;
    setFilters(next);
    url(status, next, next.area === undefined ? "" : typed);
  }
  function chooseStatus(value) {
    setOrganize(null);
    setStatus(value);
    url(value, filters, area);
  }
  const organizeChanged = useCallback((next) => writeOrganizeUrl(next), []);
  const chips = filterLabels(applied);
  const upcoming = status === "planned";
  return (
    <>
      <SocialHeader user={user} />
      <main className="page">
        <div className="section-heading">
          <div>
            <h1>Покатушки</h1>
            <p>Находите маршруты сообщества и планируйте совместные поездки.</p>
          </div>
          <div className="page-actions">
            <Link className="button secondary" href="/ride-intents">
              Хочу кататься
            </Link>
            <RideCreationActions />
          </div>
        </div>
        <div className="ride-filter-bar">
          <div className="ui-tabs" aria-label="Фильтр покатушек">
            {[
              [null, "Все"],
              ["completed", "Прошедшие"],
              ["planned", "Предстоящие"],
            ].map(([value, label]) => (
              <button
                key={label}
                aria-pressed={!organize && status === value}
                onClick={() => chooseStatus(value)}
              >
                {label}
              </button>
            ))}
            {user && (
              <button
                aria-pressed={!!organize}
                onClick={() => {
                  const next = readOrganize(new URLSearchParams());
                  setOrganize(next);
                  writeOrganizeUrl(next);
                }}
              >
                Собрать компанию
              </button>
            )}
          </div>
          {upcoming && !organize && (
            <button
              type="button"
              className="button secondary ride-filter-open"
              aria-haspopup="dialog"
              aria-expanded={sheet}
              onClick={() => {
                setDraft(filters);
                setSheet(true);
              }}
            >
              <SiteIcon name="filters" />
              Фильтры
              {chips.length > 0 && (
                <span className="badge">{chips.length}</span>
              )}
            </button>
          )}
        </div>
        {organize &&
          (user ? (
            <OrganizeWorkspace
              initial={organize}
              onFiltersChange={organizeChanged}
            />
          ) : (
            <p className="empty-state">
              Чтобы собрать компанию,{" "}
              <Link href="/login?next=%2Frides%3Fmode%3Dorganize">
                войдите в аккаунт
              </Link>
              .
            </p>
          ))}
        {upcoming && !organize && (
          <section
            className="ride-filters"
            aria-label="Фильтры предстоящих покатушек"
          >
            <FilterFields value={filters} onChange={change} idPrefix="inline" />
          </section>
        )}
        {upcoming && !organize && chips.length > 0 && (
          <div className="filter-chips" aria-label="Активные фильтры">
            {chips.map(([key, label]) => (
              <button
                key={key}
                onClick={() => {
                  change((prev) => {
                    const next = { ...prev };
                    delete next[key];
                    return next;
                  });
                  if (key === "area") setArea("");
                }}
                aria-label={"Убрать фильтр " + label}
              >
                {label}
                <X size={12} />
              </button>
            ))}
            <button
              className="quiet"
              onClick={() => {
                change({});
                setArea("");
              }}
            >
              Сбросить всё
            </button>
          </div>
        )}
        {bikeId !== null && !organize && (
          <RideList
            bikeId={bikeId}
            status={status}
            filters={upcoming ? applied : null}
            restoreKey={
              "rides:" +
              (status || "all") +
              JSON.stringify(upcoming ? applied : {})
            }
            onReset={
              chips.length
                ? () => {
                    change({});
                    setArea("");
                  }
                : undefined
            }
          />
        )}
      </main>
      <CompactDialog
        open={sheet}
        onClose={() => setSheet(false)}
        title="Фильтры"
      >
        <FilterFields value={draft} onChange={setDraft} idPrefix="sheet" />
        <div className="sheet-actions">
          <button
            type="button"
            className="button secondary small"
            onClick={() => setDraft({})}
          >
            <SiteIcon name="reset" />
            Сбросить
          </button>
          <button
            type="button"
            className="button small"
            onClick={() => {
              setArea(draft.area || "");
              change(draft, draft.area || "");
              setSheet(false);
            }}
          >
            <SiteIcon name="apply" />
            Показать
          </button>
        </div>
      </CompactDialog>
      <SocialFooter />
    </>
  );
}
