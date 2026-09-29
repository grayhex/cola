"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, startTransition } from "react";
import {
  ArrowRight,
  CalendarDays,
  LockKeyhole,
  MapPin,
  Plus,
  Users,
} from "lucide-react";
import { socialApi, AuthorLink } from "./social-primitives.jsx";
import { MotionList, SharedView } from "./motion.jsx";
import { IntentComposer, intentDraft } from "./ride-intents.jsx";
import { matchSummary } from "../../lib/ride-match-labels.js";
import { planDraftKey } from "../../lib/ride-plan-options.js";
import { publicPath } from "../../lib/public-urls.js";
import { formatIntentWindow } from "../../lib/ride-intent-time.js";
import { plural } from "../../lib/plural.js";
import styles from "./home-planner.module.css";

// Personal planning on the home page (#233). Loaded only for a signed-in
// viewer, after hydration: nothing personal is in the HTML/RSC or a cache.
const when = new Intl.DateTimeFormat("ru-RU", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const clock = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit",
  minute: "2-digit",
});
const roles = {
  organizer: ["Вы организатор", "accent"],
  accepted: ["Иду", "success"],
  maybe: ["Может быть", "warning"],
  invited: ["Приглашение · ждёт ответа", "info"],
  cancelled: ["Отменена", "danger"],
};
const durations = [
  [60, "1 ч"],
  [120, "2 ч"],
  [180, "3 ч"],
];
const limit = 5;
/** Fetch with the newest request winning; older answers are dropped.
 * `token` forces a refetch of the same path (after saving an intent). */
function useLatest(path, token = 0) {
  const [state, setState] = useState({ data: null, error: "", loading: true });
  const [revision, setRevision] = useState(0);
  const seq = useRef(0);
  useEffect(() => {
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: "" }));
    socialApi(path)
      .then((data) => {
        if (id === seq.current)
          startTransition(() => setState({ data, error: "", loading: false }));
      })
      .catch((e) => {
        if (id === seq.current)
          setState((s) => ({ ...s, error: e.message, loading: false }));
      });
  }, [path, token, revision]);
  return { ...state, retry: () => setRevision((v) => v + 1) };
}
function Failure({ error, retry }) {
  return (
    <p className="error" role="alert">
      {error}{" "}
      <button className="quiet" onClick={retry}>
        Повторить
      </button>
    </p>
  );
}
function Skeleton({ rows = 2 }) {
  return Array.from({ length: rows }, (_, i) => (
    <div key={i} className={"skeleton " + styles.skeleton} aria-hidden />
  ));
}
function Going({ state, onIds }) {
  const rides = state.data?.rides;
  useEffect(() => {
    if (rides) onIds(rides.map((r) => r.id));
  }, [rides, onIds]);
  return (
    <section className={styles.block} aria-labelledby="going-heading">
      <div className={styles.blockHead}>
        <h3 id="going-heading">Ты собираешься</h3>
        <span className="help">Ближайшие 60 дней</span>
      </div>
      {state.error && <Failure {...state} />}
      {!rides && !state.error && <Skeleton />}
      <MotionList>
        <div className={styles.rows} aria-busy={state.loading}>
          {rides?.map((r) => {
            const [label, tone] = roles[r.role] || roles.invited;
            return (
              <article
                key={r.id}
                className={"item-card " + styles.row}
                data-role={r.role}
              >
                <div className={styles.rowHead}>
                  <time className="mono" dateTime={r.scheduledAt}>
                    {when.format(new Date(r.scheduledAt))}
                  </time>
                  <span className="badge" data-tone={tone}>
                    {label}
                  </span>
                  {r.changedAfterAnswer && (
                    <span className="badge" data-tone="warning">
                      Изменено после вашего ответа
                    </span>
                  )}
                </div>
                <SharedView kind="ride-title" id={r.id}>
                  <h4>
                    <Link className="item-link" href={publicPath("ride", r)}>
                      {r.title}
                    </Link>
                  </h4>
                </SharedView>
                <p className="meta">
                  {r.role === "cancelled" ? (
                    <span>Организатор отменил этот выезд</span>
                  ) : r.meetingPoint ? (
                    <span>
                      <MapPin size={12} aria-hidden="true" />
                      {r.meetingPoint}
                    </span>
                  ) : r.meetingHidden ? (
                    <span>
                      <LockKeyhole size={12} aria-hidden="true" />
                      Место встречи откроется после «Иду»
                    </span>
                  ) : null}
                  {r.passport?.area?.label && (
                    <span>{r.passport.area.label}</span>
                  )}
                </p>
                <Link
                  className="text-link item-action"
                  href={publicPath("ride", r)}
                >
                  {r.role === "invited" ? "Ответить" : "Договорённости"}
                  <ArrowRight size={14} />
                </Link>
              </article>
            );
          })}
        </div>
      </MotionList>
      {rides && !rides.length && (
        <p className="empty-state">
          Пока нет выездов, на которые вы ответили «Иду» или «Может быть».
          Намерение «Готов ехать» само сюда не попадает.
        </p>
      )}
    </section>
  );
}
function intentLabel(intent) {
  const first = intent.windows[0];
  return [
    first ? formatIntentWindow(first, intent.timeZone) : "без окон",
    intent.passport?.area?.label,
  ]
    .filter(Boolean)
    .join(" · ");
}
function Suits({ intents, exclude, onCompose }) {
  const [intent, setIntent] = useState(""),
    [wide, setWide] = useState(false);
  const path = useMemo(() => {
    if (wide) {
      const now = Date.now();
      return (
        "ride-matches/rides?" +
        new URLSearchParams({
          from: new Date(now).toISOString(),
          to: new Date(now + 30 * 86400000).toISOString(),
        })
      );
    }
    return "ride-matches/rides" + (intent ? "?intent=" + intent : "");
  }, [intent, wide]);
  const state = useLatest(path);
  const items = (state.data?.items || []).filter(
    (i) => !exclude.includes(i.ride.id),
  );
  const basis = state.data?.basis;
  return (
    <section className={styles.block} aria-labelledby="suits-heading">
      <div className={styles.blockHead}>
        <h3 id="suits-heading">Подходит тебе</h3>
        {intents.length > 1 && (
          <div
            className={styles.context}
            role="group"
            aria-label="Подбор по намерению"
          >
            <button
              className="tag"
              aria-pressed={!intent && !wide}
              onClick={() => {
                setWide(false);
                setIntent("");
              }}
            >
              Все мои намерения
            </button>
            {intents.map((i) => (
              <button
                key={i.id}
                className="tag"
                aria-pressed={intent === i.id && !wide}
                onClick={() => {
                  setWide(false);
                  setIntent(i.id);
                }}
              >
                {i.visibility === "private" && (
                  <LockKeyhole size={12} aria-label="Только вам" />
                )}
                {intentLabel(i)}
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="help">
        {wide
          ? "Все публичные выезды ближайших 30 дней — без учёта ваших окон."
          : basis === "none"
            ? "Отметьте, когда и где хочется кататься, — без этого подбирать не по чему."
            : basis === "preferences"
              ? "Нет активного намерения: подбор по сохранённым предпочтениям, время не учитывается."
              : "По времени, области и условиям ваших намерений. Приватные намерения видите только вы."}
      </p>
      {state.error && <Failure {...state} />}
      {!state.data && !state.error && <Skeleton />}
      <MotionList>
        <div className={styles.rows} aria-busy={state.loading}>
          {items.slice(0, limit).map((item) => (
            <article
              key={item.ride.id + item.occurrenceAt}
              className={"item-card " + styles.row}
            >
              <div className={styles.rowHead}>
                <time className="mono" dateTime={item.occurrenceAt}>
                  {when.format(new Date(item.occurrenceAt))}
                  {item.expectedEndAt &&
                    "–" + clock.format(new Date(item.expectedEndAt))}
                </time>
                {item.invited && (
                  <span className="badge" data-tone="info">
                    Вас пригласили
                  </span>
                )}
                {!item.isNextOccurrence && (
                  <span className="badge">Не ближайшая дата серии</span>
                )}
              </div>
              <SharedView kind="ride-title" id={item.ride.id}>
                <h4>
                  <Link
                    className="item-link"
                    href={publicPath("ride", item.ride)}
                  >
                    {item.ride.title}
                  </Link>
                </h4>
              </SharedView>
              <ul className={styles.reasons}>
                {matchSummary(item.match).map((line) => (
                  <li key={line.text} data-tone={line.tone}>
                    {line.text}
                  </li>
                ))}
              </ul>
              <span className="item-action">
                <AuthorLink author={item.ride.author} />
              </span>
            </article>
          ))}
        </div>
      </MotionList>
      {state.data && items.length > limit && (
        <p className="help">
          Показаны {limit} лучших из {items.length}.{" "}
          <Link className="text-link" href="/rides?status=planned">
            Все предстоящие
          </Link>
        </p>
      )}
      {state.data && !items.length && !state.error && (
        <div className="empty-state">
          <p>
            {wide
              ? "В ближайшие 30 дней публичных выездов нет."
              : basis === "none"
                ? "Пока нет намерений и предпочтений для подбора."
                : "Подходящих поездок пока нет — ничего не подставляем ради заполнения."}
          </p>
          <div className={styles.actions}>
            <button className="button secondary small" onClick={onCompose}>
              {intents.length ? "Добавить время" : "Отметить, когда хочу"}
            </button>
            {!wide && (
              <button
                className="button secondary small"
                onClick={() => setWide(true)}
              >
                Показать всё на 30 дней
              </button>
            )}
            <Link className="button secondary small" href="/ride-intents">
              Изменить намерения
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}
function Gather() {
  const [minutes, setMinutes] = useState(120);
  const state = useLatest(
    `ride-matches/interest?durationMin=${minutes}&durationMax=${minutes}`,
  );
  function offer(slot) {
    try {
      sessionStorage.setItem(
        planDraftKey,
        JSON.stringify({
          scheduledAt: slot.startFrom,
          expectedEndAt: new Date(
            +new Date(slot.startFrom) + minutes * 60000,
          ).toISOString(),
        }),
      );
    } catch {}
  }
  const slots = state.data?.slots;
  return (
    <section className={styles.block} aria-labelledby="gather-heading">
      <div className={styles.blockHead}>
        <h3 id="gather-heading">Можно собраться</h3>
        <div className="segmented" role="group" aria-label="Длительность">
          {durations.map(([value, label]) => (
            <button
              key={value}
              aria-pressed={minutes === value}
              onClick={() => setMinutes(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="help">
        Когда у других есть общее свободное время на ближайшие 2 недели. Это не
        мероприятие и не записавшиеся — поездку нужно предложить.
      </p>
      {state.error && <Failure {...state} />}
      {!slots && !state.error && <Skeleton />}
      <MotionList>
        <div className={styles.rows} aria-busy={state.loading}>
          {slots?.map((slot) => (
            <article key={slot.startFrom} className={"item-card " + styles.row}>
              <div className={styles.rowHead}>
                <time className="mono" dateTime={slot.startFrom}>
                  Старт {when.format(new Date(slot.startFrom))}
                  {slot.startUntil !== slot.startFrom &&
                    "–" + clock.format(new Date(slot.startUntil))}
                </time>
              </div>
              <p className={styles.count}>
                <Users size={14} aria-hidden="true" />
                <strong>{slot.counts.total}</strong>{" "}
                {plural(slot.counts.total, "свободен", "свободны", "свободны")}{" "}
                целиком · {slot.counts.ready}{" "}
                {plural(slot.counts.ready, "готов", "готовы", "готовы")} ·{" "}
                {slot.counts.considering}{" "}
                {plural(
                  slot.counts.considering,
                  "прикидывает",
                  "прикидывают",
                  "прикидывают",
                )}
              </p>
              {slot.people.length > 0 && (
                <div className={styles.people + " item-action"}>
                  {slot.people.slice(0, 3).map((p) => (
                    <AuthorLink key={p.author.id} author={p.author} />
                  ))}
                  {slot.peopleTotal > 3 && (
                    <span className="help">и ещё {slot.peopleTotal - 3}</span>
                  )}
                </div>
              )}
              <Link
                className="button secondary small item-action"
                href="/account?tab=rides&action=plan"
                onClick={() => offer(slot)}
              >
                <Plus size={14} aria-hidden="true" /> Предложить поездку
              </Link>
            </article>
          ))}
        </div>
      </MotionList>
      {slots && !slots.length && (
        <p className="empty-state">
          Пока никто не отметил общее время на {minutes / 60} ч. Отметьте своё —
          другие увидят интерес, если вы откроете намерение сообществу.
        </p>
      )}
    </section>
  );
}
export default function HomePlanner() {
  const [composer, setComposer] = useState(null),
    [preferences, setPreferences] = useState({ passport: {} }),
    [goingIds, setGoingIds] = useState([]),
    [revision, setRevision] = useState(0),
    [notice, setNotice] = useState("");
  const going = useLatest("ride-matches/upcoming", revision);
  const intentState = useLatest("ride-intents?scope=own", revision);
  const intents = (intentState.data?.items || []).filter(
    (i) => i.status === "active",
  );
  async function compose(kind = "custom") {
    setComposer(intentDraft(kind));
    try {
      setPreferences((await socialApi("ride-intents/preferences")).preferences);
    } catch {}
  }
  return (
    <section
      className={"section " + styles.planner}
      aria-labelledby="planner-heading"
    >
      <div className={styles.intro}>
        <div>
          <span className="eyebrow">Покатушки</span>
          <h2 id="planner-heading">Покататься вместе</h2>
          <p className="help">
            Отметьте, когда хочется ехать, — подберём выезды и покажем, с кем
            можно собраться. Велосипед в гараже не нужен.
          </p>
        </div>
        <div className={styles.actions}>
          <button className="button" onClick={() => compose("weekend")}>
            <CalendarDays size={16} aria-hidden="true" /> Хочу кататься
          </button>
          <Link className="button secondary" href="/rides?status=planned">
            Все предстоящие
          </Link>
        </div>
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
      </div>
      <div className={styles.grid}>
        <Going state={going} onIds={setGoingIds} />
        <Suits
          key={revision}
          intents={intents}
          exclude={goingIds}
          onCompose={() => compose("custom")}
        />
        <Gather key={"g" + revision} />
      </div>
      {composer && (
        <IntentComposer
          initial={composer}
          preferences={preferences}
          onPreferences={setPreferences}
          onClose={() => setComposer(null)}
          onSaved={() => {
            setComposer(null);
            setNotice("Намерение сохранено — подбор обновлён");
            setRevision((v) => v + 1);
          }}
        />
      )}
    </section>
  );
}
