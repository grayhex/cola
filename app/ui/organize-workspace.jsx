"use client";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { Users } from "lucide-react";
import Modal from "./garage/modal.jsx";
import { MotionList } from "./motion.jsx";
import { Avatar, socialApi } from "./social-primitives.jsx";
import { useSite } from "./site-provider.jsx";
import { ridePlanOptions } from "../../lib/ride-plan-options.js";
import { userTimeZone } from "../../lib/user-time-zone.js";
import {
  organizeDraft,
  organizeDurations,
  organizePeriods,
  organizeQuery,
} from "../../lib/organize-filters.js";
import styles from "./organize-workspace.module.css";

// «Собрать компанию» (#234): the organizer sees when and in what format there
// is real, consenting interest — counts only — and proposes a ride on it. The
// planner opens prefilled but saves nothing by itself; invitations are an
// explicit choice after the plan is published, re-checked on the server.
const PlanComposer = dynamic(() => import("./plan-composer.jsx"), {
  ssr: false,
});

const people = (/** @type {number} */ n) =>
  n % 10 === 1 && n % 100 !== 11
    ? `${n} человек`
    : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)
      ? `${n} человека`
      : `${n} человек`;
const fieldLabels = {
  time: "время",
  area: "район",
  duration: "длительность",
  distance: "дистанция",
  pace: "темп",
  purpose: "цель",
  surface: "покрытие",
  difficulty: "сложность",
  speed: "скорость",
  groupSize: "размер компании",
  regroupPolicy: "ожидание",
  beginnerFriendly: "новички",
};
const outcome = {
  invited: "Приглашение отправлено",
  already_invited: "Уже приглашён",
  declined: "Отказался от этой поездки — не приглашён",
  unavailable: "Интерес изменился — не приглашён",
  limit: "Достигнут лимит приглашений — не приглашён",
};

function useZoneFormat(zone) {
  return useCallback(
    (/** @type {string} */ iso, /** @type {Intl.DateTimeFormatOptions} */ o) =>
      new Intl.DateTimeFormat("ru-RU", { timeZone: zone, ...o }).format(
        new Date(iso),
      ),
    [zone],
  );
}

function Filters({ value, onChange }) {
  const set = (key, v) =>
    onChange((prev) => {
      const next = { ...prev };
      if (!v) delete next[key];
      else next[key] = v;
      return next;
    });
  const segmented = (key, label, options) => (
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
  const select = (key, label) => (
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

function GroupRow({ group, format, onPropose }) {
  const day = format(group.startFrom, {
      weekday: "short",
      day: "numeric",
      month: "short",
    }),
    from = format(group.startFrom, { hour: "2-digit", minute: "2-digit" }),
    until = format(group.startUntil, { hour: "2-digit", minute: "2-digit" });
  const tallies = [
    ...Object.entries(group.formats.purpose).map(([k, n]) => [
      ridePlanOptions.purpose[k],
      n,
    ]),
    ...Object.entries(group.formats.pace).map(([k, n]) => [
      ridePlanOptions.pace[k],
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
        aria-label={"Предложить покатушку: " + when}
        onClick={() => onPropose(group)}
      >
        Предложить покатушку
      </button>
    </article>
  );
}

/** After the plan is published: people whose intent fits this occurrence,
 * chosen one by one; the server checks each again before inviting. */
export function InviteFromInterest({ plan, onClose }) {
  const [state, setState] = useState({ status: "loading" }),
    [page, setPage] = useState(1),
    [chosen, setChosen] = useState(() => new Set()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [results, setResults] = useState(null),
    [revision, setRevision] = useState(0);
  const sending = useRef(false);
  useEffect(() => {
    let active = true;
    setState((s) => ({ ...s, status: s.items ? "reloading" : "loading" }));
    socialApi(
      `ride-matches/plans/${plan.id}/interest?` +
        new URLSearchParams({
          occurrenceAt: plan.occurrenceAt,
          page: String(page),
        }),
    )
      .then((data) => {
        if (active)
          setState({
            status: "ready",
            items: data.people.items,
            pages: data.people.pages,
            total: data.people.total,
          });
      })
      .catch((e) => {
        if (active) setState({ status: "error", error: e.message });
      });
    return () => {
      active = false;
    };
  }, [plan.id, plan.occurrenceAt, page, revision]);
  async function send() {
    // One request at a time: a second click waits for the first answer.
    if (sending.current || !chosen.size) return;
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      const answer = await socialApi(
        `ride-matches/plans/${plan.id}/invitations`,
        "POST",
        { occurrenceAt: plan.occurrenceAt, userIds: [...chosen] },
      );
      // Names as they were when sent: the list reloads without people whose
      // interest changed, but the answer still says who was not invited.
      const known = new Map(
        (state.items || []).map((p) => [p.author.id, p.author.name]),
      );
      setResults({
        ...answer,
        results: answer.results.map((r) => ({
          ...r,
          name: known.get(r.userId) || "Участник",
        })),
      });
      setChosen(new Set());
      setRevision((v) => v + 1);
    } catch (e) {
      setError(e.message);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal wide title="Пригласить заинтересованных" onClose={onClose}>
      <div className="planning-body">
        <section className="planning-section" aria-labelledby="invite-people">
          <h3 id="invite-people">Кого пригласить</h3>
          <p className="help">
            Покатушка сохранена. Здесь люди, чьё намерение подходит к её времени
            и формату и кто разрешил предложения. Приглашение — не участие:
            каждый ответит сам.
          </p>
          {state.status === "loading" && <p role="status">Подбираем людей…</p>}
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
          {state.items && !state.items.length && (
            <p className="empty-state">
              Сейчас нет людей, чьё намерение подходит к этой поездке. Её увидят
              в ленте покатушек.
            </p>
          )}
          {state.items && state.items.length > 0 && (
            <ul className={styles.people} aria-busy={state.status !== "ready"}>
              {state.items.map((p) => {
                const locked = p.invited || p.declined;
                return (
                  <li key={p.author.id}>
                    <label className={styles.person}>
                      <input
                        type="checkbox"
                        disabled={locked || busy}
                        checked={locked ? p.invited : chosen.has(p.author.id)}
                        onChange={(e) =>
                          setChosen((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(p.author.id);
                            else next.delete(p.author.id);
                            return next;
                          })
                        }
                      />
                      <Avatar person={p.author} size="small" />
                      <span className={styles.personText}>
                        <strong>{p.author.name}</strong>
                        <span className="meta">
                          <span>@{p.author.username}</span>
                          <span>
                            {p.readiness === "ready"
                              ? "Готов ехать"
                              : "Пока прикидывает"}
                          </span>
                          {p.invited && <span>Уже приглашён</span>}
                          {p.declined && <span>Отказался от этой поездки</span>}
                        </span>
                        {p.match.matched.length > 0 && (
                          <small>
                            Совпадает:{" "}
                            {p.match.matched
                              .map((f) => fieldLabels[f] || f)
                              .join(", ")}
                          </small>
                        )}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {state.pages > 1 && (
            <div className={styles.pager}>
              <button
                type="button"
                className="button secondary small"
                disabled={page <= 1 || busy}
                onClick={() => setPage((v) => v - 1)}
              >
                Назад
              </button>
              <span className="mono">
                {page} / {state.pages}
              </span>
              <button
                type="button"
                className="button secondary small"
                disabled={page >= state.pages || busy}
                onClick={() => setPage((v) => v + 1)}
              >
                Дальше
              </button>
            </div>
          )}
          {results && (
            <div role="status" className={styles.results}>
              <p>
                <strong>Отправлено приглашений: {results.invited}</strong>
              </p>
              <ul>
                {results.results
                  .filter((r) => r.status !== "invited")
                  .map((r) => (
                    <li key={r.userId}>
                      {r.name}: {outcome[r.status]}
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </section>
      </div>
      <div className="planning-actions">
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button type="button" className="button secondary" onClick={onClose}>
          Готово
        </button>
        <button
          type="button"
          className="button"
          disabled={!chosen.size || busy}
          onClick={send}
        >
          {busy
            ? "Отправляем…"
            : `Пригласить выбранных${chosen.size ? ` (${chosen.size})` : ""}`}
        </button>
      </div>
    </Modal>
  );
}

export default function OrganizeWorkspace({ initial, onFiltersChange }) {
  const { personalSettings } = useSite();
  const format = useZoneFormat(userTimeZone(personalSettings));
  const [filters, setFilters] = useState(initial),
    [state, setState] = useState({ status: "loading" }),
    [revision, setRevision] = useState(0),
    [proposal, setProposal] = useState(null),
    [invite, setInvite] = useState(null),
    [notice, setNotice] = useState("");
  // A typed district waits for a pause; choices apply at once.
  const [query, setQuery] = useState(() => organizeQuery(initial).toString());
  useEffect(() => {
    const timer = setTimeout(
      () => setQuery(organizeQuery(filters).toString()),
      250,
    );
    onFiltersChange?.(filters);
    return () => clearTimeout(timer);
  }, [filters, onFiltersChange]);
  useEffect(() => {
    const controller = new AbortController();
    setState((s) => ({ ...s, status: s.data ? "reloading" : "loading" }));
    fetch("/api/ride-matches/groups?" + query, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw Error(data.error || "Не удалось загрузить интерес");
        setState({ status: "ready", data });
      })
      .catch((e) => {
        if (e.name !== "AbortError")
          setState({
            status: "error",
            error: e.message || "Не удалось загрузить интерес",
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
      </p>
      <Filters value={filters} onChange={setFilters} />
      {notice && (
        <p role="status" className={styles.notice}>
          {notice} <Link href="/account?tab=rides">Мои покатушки</Link>
        </p>
      )}
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
            или длительность — или предложите покатушку сами.
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
                onPropose={(g) => {
                  setNotice("");
                  setProposal(organizeDraft(filters, g));
                }}
              />
            ))}
          </MotionList>
        </div>
      )}
      {proposal && (
        <PlanComposer
          draft={proposal}
          title="Предложить покатушку"
          onClose={() => setProposal(null)}
          onSaved={(_, created) => {
            setProposal(null);
            if (created) setInvite(created);
          }}
        />
      )}
      {invite && (
        <InviteFromInterest
          plan={invite}
          onClose={() => {
            setInvite(null);
            setNotice("Покатушка создана.");
            setRevision((v) => v + 1);
          }}
        />
      )}
    </div>
  );
}
