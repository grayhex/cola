"use client";
import type { Dispatch, SetStateAction } from "react";
import type { ApiError } from "../../lib/contracts.ts";
import type { InterestGroupsDto, PlanDraft } from "./ride-types.ts";
type ZoneFormat = (iso: string, options: Intl.DateTimeFormatOptions) => string;
type GroupsState = {
  status: "loading" | "reloading" | "ready" | "error";
  data?: InterestGroupsDto;
  error?: string;
};
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Users } from "lucide-react";
import { MotionList } from "./motion.tsx";
import { useSite } from "./site-provider.tsx";
import { errorMessage } from "../../lib/errors.ts";
import { ridePlanOptions } from "../../lib/ride-plan-options.ts";
import { userTimeZone } from "../../lib/user-time-zone.ts";
import {
  organizeDraft,
  organizeDurations,
  organizePeriods,
  organizeQuery,
} from "../../lib/organize-filters.ts";
import styles from "./plan-interest.module.css";

// «Подобрать время по интересам» in the planner (#234, #370): the organizer
// sees when and in what format there is real, consenting interest — counts
// only — and takes a group's start and format into the plan form. Choosing a
// time saves nothing by itself; invitations are an explicit choice after the
// plan is published, re-checked on the server.
const people = (n: number) =>
  n % 10 === 1 && n % 100 !== 11
    ? `${n} человек`
    : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)
      ? `${n} человека`
      : `${n} человек`;

function useZoneFormat(zone: string): ZoneFormat {
  return useCallback(
    (iso: string, o: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat("ru-RU", { timeZone: zone, ...o }).format(
        new Date(iso),
      ),
    [zone],
  );
}

function Filters({
  value,
  onChange,
}: {
  value: Record<string, string>;
  onChange: Dispatch<SetStateAction<Record<string, string>>>;
}) {
  const set = (key: string, v: string) =>
    onChange((prev) => {
      const next = { ...prev };
      if (!v) delete next[key];
      else next[key] = v;
      return next;
    });
  const segmented = (
    key: string,
    label: string,
    options: Readonly<Record<string, string | readonly [string, object]>>,
  ) => (
    <div className="filter-group">
      <span className={styles.filterLabel} id={"organize-" + key}>
        {label}
      </span>
      <div
        className="segmented"
        role="group"
        aria-labelledby={"organize-" + key}
      >
        {Object.entries(options).map(([v, text]) => (
          <button
            key={v}
            type="button"
            aria-pressed={value[key] === v}
            onClick={() => set(key, v)}
          >
            {Array.isArray(text) ? text[0] : text}
          </button>
        ))}
      </div>
    </div>
  );
  const select = (key: "purpose" | "pace" | "surface", label: string) => (
    <label className="field" key={key}>
      <span>{label}</span>
      <select
        value={value[key] || ""}
        onChange={(e) => set(key, e.target.value)}
      >
        <option value="">Любой</option>
        {Object.entries(ridePlanOptions[key]).map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <section className={styles.filters} aria-label="Условия поиска компании">
      {segmented("when", "Когда", organizePeriods)}
      {segmented("duration", "Длительность", organizeDurations)}
      <div className={styles.fields}>
        {select("purpose", "Цель")}
        {select("pace", "Темп")}
        {select("surface", "Покрытие")}
        <label className="field">
          <span>Район или парк</span>
          <input
            type="search"
            maxLength={100}
            placeholder="Например, Сокольники"
            defaultValue={value.area || ""}
            onChange={(e) => set("area", e.target.value.trim())}
          />
        </label>
      </div>
    </section>
  );
}

function GroupRow({
  group,
  format,
  onPropose,
}: {
  group: InterestGroupsDto["groups"][number];
  format: ZoneFormat;
  onPropose: (group: InterestGroupsDto["groups"][number]) => void;
}) {
  const day = format(group.startFrom, {
      weekday: "short",
      day: "numeric",
      month: "short",
    }),
    from = format(group.startFrom, { hour: "2-digit", minute: "2-digit" }),
    until = format(group.startUntil, { hour: "2-digit", minute: "2-digit" });
  const tallies = [
    ...Object.entries(group.formats.purpose).map(([k, n]) => [
      Object.entries(ridePlanOptions.purpose).find(([key]) => key === k)?.[1],
      n,
    ]),
    ...Object.entries(group.formats.pace).map(([k, n]) => [
      Object.entries(ridePlanOptions.pace).find(([key]) => key === k)?.[1],
      n,
    ]),
  ].filter(([label]) => label);
  const when = `${day}, старт ${from === until ? from : `${from}–${until}`}`;
  return (
    <article className={styles.group} aria-label={when}>
      <div className={styles.when}>
        <strong>{day}</strong>
        <span className="mono">
          старт {from === until ? from : `${from}–${until}`}
        </span>
      </div>
      <div className={styles.counts}>
        <strong>
          <Users size={14} aria-hidden="true" /> {people(group.counts.total)}
        </strong>
        <span className="badge" data-tone="success">
          Готовы: {group.counts.ready}
        </span>
        <span className="badge">Прикидывают: {group.counts.considering}</span>
      </div>
      {tallies.length > 0 && (
        <ul className={styles.tallies} aria-label="Чего хотят">
          {tallies.map(([label, n]) => (
            <li key={label} className="tag">
              {label} · {n}
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        className="button secondary small"
        aria-label={"Выбрать время: " + when}
        onClick={() => onPropose(group)}
      >
        Выбрать это время
      </button>
    </article>
  );
}

export default function InterestFinder({
  initial,
  onPropose,
}: {
  initial: Record<string, string>;
  onPropose: (draft: PlanDraft) => void;
}) {
  const { personalSettings } = useSite();
  const format = useZoneFormat(userTimeZone(personalSettings));
  const [filters, setFilters] = useState(initial),
    [state, setState] = useState<GroupsState>({ status: "loading" }),
    [revision, setRevision] = useState(0);
  // A typed district waits for a pause; choices apply at once.
  const [query, setQuery] = useState(() => organizeQuery(initial).toString());
  // The period is stamped with the current time, so a rebuilt query always
  // differs from the last one: rebuild it only for new choices. Rebuilding
  // after the first render sent the same request twice.
  const queried = useRef(initial);
  useEffect(() => {
    if (filters === queried.current) return;
    const timer = setTimeout(() => {
      queried.current = filters;
      setQuery(organizeQuery(filters).toString());
    }, 250);
    return () => clearTimeout(timer);
  }, [filters]);
  useEffect(() => {
    const controller = new AbortController();
    setState((s) => ({ ...s, status: s.data ? "reloading" : "loading" }));
    fetch("/api/ride-matches/groups?" + query, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (r) => {
        const data: InterestGroupsDto & Partial<ApiError> = await r.json();
        if (!r.ok) throw Error(data.error || "Не удалось загрузить интерес");
        setState({ status: "ready", data });
      })
      .catch((e) => {
        if (!(e instanceof Error && e.name === "AbortError"))
          setState({
            status: "error",
            error: errorMessage(e) || "Не удалось загрузить интерес",
          });
      });
    return () => controller.abort();
  }, [query, revision]);
  const groups = state.data?.groups || [];
  return (
    <div className={styles.workspace}>
      <p className={styles.lead}>
        Когда и в каком формате людям хочется кататься. Здесь только те, кто
        разрешил предложения; числа — это интерес, а не записи на поездку.
        Выбранное время попадёт в форму ниже, сохранится оно только вместе с
        покатушкой.
      </p>
      <Filters value={filters} onChange={setFilters} />
      {state.status === "loading" && (
        <div className={styles.groups} aria-hidden="true">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className={"skeleton " + styles.skeleton} />
          ))}
        </div>
      )}
      {state.status === "error" && (
        <div className="empty-state">
          <p role="alert" className="error">
            {state.error}
          </p>
          <button
            type="button"
            className="button secondary small"
            onClick={() => setRevision((v) => v + 1)}
          >
            Повторить
          </button>
        </div>
      )}
      {state.data && !groups.length && state.status !== "error" && (
        <div className="empty-state">
          <p>
            Под эти условия пока нет общего времени. Попробуйте другой период
            или длительность — или заполните форму сами.
          </p>
          <Link className="text-link" href="/ride-intents">
            Отметить, когда хочется кататься
          </Link>
        </div>
      )}
      {groups.length > 0 && state.status !== "error" && (
        <div
          className={styles.groups}
          aria-label="Группы интереса"
          aria-busy={state.status === "reloading"}
        >
          <MotionList>
            {groups.map((group) => (
              <GroupRow
                key={group.startFrom}
                group={group}
                format={format}
                onPropose={(g) => onPropose(organizeDraft(filters, g))}
              />
            ))}
          </MotionList>
        </div>
      )}
    </div>
  );
}
