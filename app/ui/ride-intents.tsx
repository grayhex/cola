"use client";
import PlanningGraphic from "./planning-graphic.tsx";
import type { FormEvent } from "react";
import type {
  IntentDto,
  IntentListDto,
  IntentDraft,
  IntentWindowDraft,
  PreferencesDraft,
  IntentPreferencesDto,
  PassportDraft,
} from "./ride-types.ts";
import { errorMessage, errorStatus } from "../../lib/errors.ts";
import Link from "next/link";
import { useEffect, useRef, useState, startTransition } from "react";
import {
  Plus,
  CalendarDays,
  Check,
  LockKeyhole,
  Users,
  Bike,
  SlidersHorizontal,
  RefreshCw,
  Trash2,
} from "lucide-react";
import PassportTiles from "./passport-tiles.tsx";
import { useSite } from "./site-provider.tsx";
import {
  SocialHeader,
  SocialFooter,
  socialApi,
  AuthorLink,
} from "./social-primitives.tsx";
import AuthPage from "./auth-page.tsx";
import { useConfirmation } from "./confirmation.tsx";
import Modal from "./garage/modal.tsx";
import { MotionList, SharedView, useMotionFeedback } from "./motion.tsx";
import { AreaField, ExtraConditions } from "./ride-plan-fields.tsx";
import RidePassport from "./ride-passport.tsx";
import {
  intentLimits,
  validTimeZone,
  localInstants,
  resolveLocal,
  quickWindows,
  windowDraft,
  formatIntentWindow,
} from "../../lib/ride-intent-time.ts";
import { userTimeZone } from "../../lib/user-time-zone.ts";
import styles from "./ride-intents.module.css";
const blankWindow = (): IntentWindowDraft => ({ startLocal: "", endLocal: "" });
const readinessLabels: Record<string, string> = {
  ready: "Готов ехать",
  considering: "Пока прикидываю",
};
const api = <T = unknown,>(
  path = "",
  method = "GET",
  body?: unknown,
): Promise<T> => socialApi<T>("ride-intents" + path, method, body);
function previewWindows(draft: IntentDraft) {
  try {
    return draft.windows.map((w) => ({
      startsAt: resolveLocal(w.startLocal, draft.timeZone, w.startFold),
      endsAt: resolveLocal(w.endLocal, draft.timeZone, w.endFold),
    }));
  } catch {
    return [];
  }
}
function TimeField({
  side,
  window,
  zone,
  index,
  onChange,
}: {
  side: "start" | "end";
  window: IntentWindowDraft;
  zone: string;
  index: number;
  onChange: (value: IntentWindowDraft) => void;
}) {
  const key = side === "start" ? "startLocal" : "endLocal",
    foldKey = side === "start" ? "startFold" : "endFold";
  let choices: string[] = [];
  try {
    choices = localInstants(window[key], zone);
  } catch {
    // An incomplete local time has no occurrences to choose from.
  }
  return (
    <div>
      <label className="field">
        <span>{side === "start" ? "Могу с" : "Свободен до"}</span>
        <input
          aria-label={`Окно ${index + 1}: ${side === "start" ? "с" : "до"}`}
          type="datetime-local"
          required
          value={window[key]}
          onChange={(e) =>
            onChange({ ...window, [key]: e.target.value, [foldKey]: undefined })
          }
        />
      </label>
      {choices.length > 1 && (
        <label className="field">
          <span>
            Время повторяется — {side === "start" ? "начало" : "конец"}
          </span>
          <select
            required
            value={window[foldKey] || ""}
            onChange={(e) => onChange({ ...window, [foldKey]: e.target.value })}
          >
            <option value="">Выберите вхождение</option>
            {choices.map((time, n) => (
              <option key={time} value={n ? "later" : "earlier"}>
                {n ? "Второй" : "Первый"} раз · {time.slice(11, 16)} UTC
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
export function IntentComposer({
  initial,
  preferences,
  onSaved,
  onClose,
  onPreferences,
}: {
  initial: IntentDraft;
  preferences: PreferencesDraft;
  onSaved: () => void;
  onClose: () => void;
  onPreferences: (value: PreferencesDraft) => void;
}) {
  const [draft, setDraft] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [uncertain, setUncertain] = useState(false);
  const pending = useRef<Omit<IntentDraft, "id"> | null>(null),
    closing = useRef(false);
  const [ask, confirmation] = useConfirmation();
  const feedback = useMotionFeedback(draft.readiness);
  const set = <K extends keyof IntentDraft>(key: K, value: IntentDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  async function close() {
    if (busy || closing.current) return;
    closing.current = true;
    if (
      !dirty ||
      (await ask(
        uncertain
          ? "Ответ сервера не получен. После закрытия обновите список перед созданием нового намерения."
          : "Закрыть форму и потерять несохранённые изменения?",
        { confirmLabel: "Закрыть форму" },
      ))
    )
      onClose();
    closing.current = false;
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    if (!draft.passport.purpose) {
      setError("Выберите цель поездки");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    const { id, requestId, ...body } = draft;
    if (!pending.current) pending.current = id ? body : { ...body, requestId };
    try {
      await api(id ? "/" + id : "", id ? "PUT" : "POST", pending.current);
      onSaved();
    } catch (e) {
      const status = errorStatus(e);
      const ambiguous = !status || status >= 500;
      setUncertain(ambiguous);
      if (!ambiguous) pending.current = null;
      setError(
        errorMessage(e) || "Не удалось получить ответ. Повторите отправку.",
      );
    } finally {
      setBusy(false);
    }
  }
  const windows = previewWindows(draft);
  return (
    <>
      <Modal
        graphic={<PlanningGraphic slot="intentDialogGraphic" />}
        wide
        title={draft.id ? "Изменить намерение" : "Новое намерение"}
        onClose={close}
        dismissible={!busy}
      >
        {/* #253: when → where → how → who sees it, in the wide planner
            shell; the zone is the profile's (an edit keeps its own). The
            same window opens from the home page and /ride-intents (#264). */}
        <form onSubmit={save} className="intent-form">
          <div className="planning-body">
            <p className="planning-lead">
              Намерение — это конкретный раз: когда и где хочется покататься.
              Постоянные предпочтения хранятся отдельно и меняются, только если
              сохранить их кнопкой ниже.
            </p>
            <fieldset
              className="planning-section half"
              disabled={busy || uncertain}
            >
              <legend>
                <span className="step" aria-hidden="true">
                  1
                </span>
                Когда
              </legend>
              <div
                className="segmented"
                role="group"
                aria-label="Готовность"
                ref={feedback}
              >
                {Object.entries(readinessLabels).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={draft.readiness === key}
                    onClick={() => set("readiness", key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className={styles.quick}>
                {[
                  ["tonight", "Сегодня вечером"],
                  ["weekend", "В выходные"],
                ].map(([kind, label]) => (
                  <button
                    key={kind}
                    type="button"
                    className="button secondary small"
                    disabled={
                      !validTimeZone(draft.timeZone) ||
                      !quickWindows(kind, draft.timeZone).length
                    }
                    onClick={() =>
                      set("windows", quickWindows(kind, draft.timeZone))
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className={styles.windowList}>
                {draft.windows.map((w, index) => (
                  <div key={index} className={styles.window}>
                    <div className={styles.windowHead}>
                      <strong>Окно {index + 1}</strong>
                      <button
                        type="button"
                        className="icon secondary small danger"
                        disabled={draft.windows.length === 1}
                        aria-label={`Удалить окно ${index + 1}`}
                        title="Удалить окно"
                        onClick={() =>
                          set(
                            "windows",
                            draft.windows.filter((_, n) => n !== index),
                          )
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className={styles.windowTimes}>
                      {(["start", "end"] as const).map((side) => (
                        <TimeField
                          key={side}
                          side={side}
                          window={w}
                          zone={draft.timeZone}
                          index={index}
                          onChange={(v) =>
                            set(
                              "windows",
                              draft.windows.map((row, n) =>
                                n === index ? v : row,
                              ),
                            )
                          }
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="quiet"
                disabled={draft.windows.length >= intentLimits.windows}
                onClick={() =>
                  set("windows", [...draft.windows, blankWindow()])
                }
              >
                <Plus size={16} /> Добавить окно
              </button>
              <small className="help">
                Поездка целиком помещается в окно; до 4 окон по 24 ч. Время —{" "}
                {draft.timeZone}
                {draft.id ? "." : " из профиля."}
              </small>
            </fieldset>
            <fieldset
              className="planning-section half"
              disabled={busy || uncertain}
            >
              <legend>
                <span className="step" aria-hidden="true">
                  2
                </span>
                Где
              </legend>
              <AreaField
                value={draft.passport}
                onChange={(v) => set("passport", v)}
                intent
              />
            </fieldset>
            <fieldset
              className="planning-section two-thirds"
              disabled={busy || uncertain}
            >
              <legend>
                <span className="step" aria-hidden="true">
                  3
                </span>
                Как хочется кататься
              </legend>
              <PassportTiles
                value={draft.passport}
                onChange={(v) => set("passport", v)}
                required={["purpose"]}
              />
              <div className={styles.quick}>
                <button
                  type="button"
                  className="quiet"
                  disabled={!Object.keys(preferences.passport || {}).length}
                  onClick={() => {
                    setDraft((d) => ({
                      ...d,
                      passport: { ...preferences.passport, ...d.passport },
                      meetNewPeople:
                        d.meetNewPeople ?? preferences.meetNewPeople,
                    }));
                    setNotice(
                      "Постоянные предпочтения подставлены в незаполненные условия",
                    );
                  }}
                >
                  Подставить постоянные предпочтения
                </button>
                <button
                  type="button"
                  className="quiet"
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      const result = await api<{
                        preferences: IntentPreferencesDto;
                      }>("/preferences", "PUT", {
                        passport: draft.passport,
                        ...(draft.meetNewPeople === undefined
                          ? {}
                          : { meetNewPeople: draft.meetNewPeople }),
                      });
                      onPreferences(result.preferences);
                      setNotice(
                        "Постоянные предпочтения сохранены только для вас. Намерение пока не сохранено.",
                      );
                    } catch (e) {
                      setError(errorMessage(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Сохранить как постоянные предпочтения
                </button>
              </div>
            </fieldset>
            <section
              className={"planning-section third " + styles.preview}
              aria-label="Предпросмотр намерения"
            >
              <div>
                <strong>{readinessLabels[draft.readiness]}</strong>
                <span className="badge">
                  {draft.visibility === "private" ? "Только мне" : "Сообществу"}
                </span>
              </div>
              {windows.length ? (
                windows.map((w) => (
                  <p key={w.startsAt + w.endsAt}>
                    {formatIntentWindow(w, draft.timeZone)}
                  </p>
                ))
              ) : (
                <p className="help">Выберите точные даты и время</p>
              )}
              <p>{draft.passport.area?.label || "Укажите район или парк"}</p>
            </section>
            {/* Who sees it, suggestions, company and extra conditions: folded
              by default (#264); the fields stay mounted, so nothing typed is
              lost when the section closes. */}
            <details className="planning-advanced intent-advanced">
              <summary>
                Дополнительно ·{" "}
                {draft.visibility === "private" ? "только мне" : "сообществу"}
                {draft.allowSuggestions ? ", предложения включены" : ""}
              </summary>
              <div className="planning-body">
                <fieldset
                  className="planning-section half"
                  disabled={busy || uncertain}
                >
                  <legend>
                    <span className="step" aria-hidden="true">
                      4
                    </span>
                    Кому видно
                  </legend>
                  <div className="option-tiles">
                    {(
                      [
                        [
                          "private",
                          "Только мне — для подбора",
                          "Видите только вы. Используется для вашего подбора.",
                          LockKeyhole,
                        ],
                        [
                          "community",
                          "Сообществу ColaBike",
                          "Видны имя, район и расписание, без точного адреса. Нужна подтверждённая почта.",
                          Users,
                        ],
                      ] as const
                    ).map(([key, label, hint, Icon]) => (
                      <label className="option-tile" key={key}>
                        <input
                          type="radio"
                          name="intent-visibility"
                          aria-label={label}
                          aria-describedby={"visibility-" + key}
                          checked={draft.visibility === key}
                          onChange={() => set("visibility", key)}
                        />
                        <Icon size={16} aria-hidden="true" />
                        <span>
                          <strong>{label}</strong>
                          <small id={"visibility-" + key}>{hint}</small>
                        </span>
                      </label>
                    ))}
                  </div>
                  <label className="check">
                    <input
                      type="checkbox"
                      role="switch"
                      className="toggle"
                      aria-label="Можно предлагать мне подходящие поездки"
                      aria-describedby="suggestions-hint"
                      checked={draft.allowSuggestions}
                      onChange={(e) =>
                        set("allowSuggestions", e.target.checked)
                      }
                    />
                    <span>
                      Можно предлагать мне подходящие поездки
                      <small id="suggestions-hint">
                        Отдельное разрешение. Email и push не включаются;
                        приватные условия организаторам не показываются.
                      </small>
                    </span>
                  </label>
                </fieldset>
                <fieldset
                  className="planning-section half"
                  disabled={busy || uncertain}
                >
                  <legend>Знакомства и условия</legend>
                  <label className="field">
                    <span>Готовность знакомиться</span>
                    <select
                      value={
                        draft.meetNewPeople === undefined
                          ? ""
                          : String(draft.meetNewPeople)
                      }
                      onChange={(e) =>
                        set(
                          "meetNewPeople",
                          e.target.value === ""
                            ? undefined
                            : e.target.value === "true",
                        )
                      }
                    >
                      <option value="">Не уточнено</option>
                      <option value="true">Рад новым знакомствам</option>
                      <option value="false">
                        Предпочитаю знакомую компанию
                      </option>
                    </select>
                  </label>
                  <ExtraConditions
                    value={draft.passport}
                    onChange={(v) => set("passport", v)}
                  />
                </fieldset>
              </div>
            </details>
          </div>
          <div className="planning-actions">
            {notice && (
              <p role="status" className="notice">
                {notice}
              </p>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            {uncertain && (
              <p className="help">
                Повторная отправка проверит тот же запрос и не создаст копию.
                Условия сохранены в форме.
              </p>
            )}
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={close}
            >
              Отмена
            </button>
            <button className="button" disabled={busy} aria-busy={busy}>
              {busy
                ? "Сохраняем…"
                : uncertain
                  ? "Повторить отправку"
                  : draft.id
                    ? "Сохранить изменения"
                    : "Сохранить намерение"}
            </button>
          </div>
        </form>
      </Modal>
      {confirmation}
    </>
  );
}
/** A composer draft: a quick window, a copy of `item`, or its edit. */
export function intentDraft(
  kind = "custom",
  item: IntentDto | null = null,
  edit = false,
  zone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): IntentDraft {
  // An existing intent keeps its zone; a new one uses the profile's (#253).
  const timeZone = item?.timeZone || zone;
  const windows =
    edit && item
      ? item.windows.map((w) => windowDraft(w, timeZone))
      : kind === "custom"
        ? [blankWindow()]
        : quickWindows(kind, timeZone);
  return {
    ...(edit && item ? { id: item.id } : { requestId: crypto.randomUUID() }),
    readiness: item?.readiness || "considering",
    timeZone,
    windows: windows.length ? windows : [blankWindow()],
    passport: item?.passport || {},
    ...(item?.meetNewPeople === undefined
      ? {}
      : { meetNewPeople: item.meetNewPeople }),
    visibility: edit && item ? item.visibility : "private",
    allowSuggestions: edit && item ? item.allowSuggestions : false,
  };
}
function IntentCard({
  item,
  busy,
  onEdit,
  onRepeat,
  onAction,
}: {
  item: IntentDto;
  busy: boolean;
  onEdit: (item: IntentDto) => void;
  onRepeat: (item: IntentDto) => void;
  onAction: (item: IntentDto, remove: boolean) => void;
}) {
  const state =
    item.status === "expired"
      ? "Истекло"
      : item.status === "cancelled"
        ? "Отменено"
        : readinessLabels[item.readiness];
  return (
    <article className={styles.card} data-intent-id={item.id}>
      <div className={styles.cardHead}>
        <SharedView kind="intent" id={item.id}>
          <h2>{state}</h2>
        </SharedView>
        <span className="badge">
          {item.visibility === "private" ? (
            <>
              <LockKeyhole size={14} /> Только мне
            </>
          ) : (
            <>
              <Users size={14} /> Сообществу
            </>
          )}
        </span>
      </div>
      {!item.own && <AuthorLink author={item.author} />}
      <ul className={styles.intervals}>
        {item.windows.map((w) => (
          <li key={w.startsAt}>
            <CalendarDays size={16} aria-hidden="true" />
            {formatIntentWindow(w, item.timeZone)}
          </li>
        ))}
      </ul>
      <small className="help">{item.timeZone} · окно доступности целиком</small>
      <RidePassport passport={item.passport} region={false} />
      {item.meetNewPeople !== undefined && (
        <p className="help">
          {item.meetNewPeople
            ? "Рад новым знакомствам"
            : "Предпочитаю знакомую компанию"}
        </p>
      )}
      {item.own && (
        <>
          <p className="help">
            {item.allowSuggestions
              ? "Подходящие поездки можно предлагать"
              : "Предложения поездок выключены"}
          </p>
          <div className={styles.cardActions}>
            {!["cancelled", "expired"].includes(item.status) && (
              <>
                <button
                  className="button secondary small"
                  disabled={busy}
                  onClick={() => onEdit(item)}
                >
                  Изменить
                </button>
                <button
                  className="quiet"
                  disabled={busy}
                  onClick={() => onAction(item, false)}
                >
                  Отменить
                </button>
              </>
            )}
            <button
              className="quiet"
              disabled={busy}
              onClick={() => onRepeat(item)}
            >
              Повторить с новыми датами
            </button>
            {/* Destructive action stands apart from the everyday ones. */}
            <button
              className={"quiet danger " + styles.remove}
              disabled={busy}
              onClick={() => onAction(item, true)}
            >
              <Trash2 size={14} aria-hidden="true" /> Удалить
            </button>
          </div>
        </>
      )}
    </article>
  );
}
// Calendar + bicycle in the site's line style; colours follow the theme.
function IntentIllustration() {
  return (
    <svg
      className={styles.illustration}
      viewBox="0 0 120 88"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="8" y="10" width="62" height="54" rx="8" className={styles.art} />
      <path d="M8 26h62M22 4v12M56 4v12" className={styles.art} />
      <rect
        x="19"
        y="34"
        width="10"
        height="8"
        rx="2"
        className={styles.artAccent}
      />
      <path d="M36 38h24M19 50h41" className={styles.artSoft} />
      <circle cx="74" cy="68" r="13" className={styles.art} />
      <circle cx="106" cy="68" r="13" className={styles.art} />
      <path
        d="M74 68l12-18h14l6 18M86 50l8 18h-20M84 44h8M98 44l2 6"
        className={styles.artAccentLine}
      />
    </svg>
  );
}
const howSteps = [
  "Укажите, когда хотите кататься и на каких условиях.",
  "ColaBike подберёт подходящие покатушки и единомышленников.",
  "Участие в конкретной покатушке подтверждается отдельно.",
];
export default function RideIntents() {
  const { viewer, personalSettings } = useSite();
  const [scope, setScope] = useState("own"),
    [page, setPage] = useState(1),
    [revision, setRevision] = useState(0),
    [data, setData] = useState<(IntentListDto & { scope: string }) | null>(
      null,
    ),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [draft, setDraft] = useState<IntentDraft | null>(null),
    [preferences, setPreferences] = useState<PreferencesDraft>({
      passport: {},
    }),
    [prefDraft, setPrefDraft] = useState<PassportDraft | null>(null),
    [prefBusy, setPrefBusy] = useState(false),
    [prefMessage, setPrefMessage] = useState(""),
    [prefError, setPrefError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [ask, confirmation] = useConfirmation();
  const saved = useMotionFeedback<SVGSVGElement>(message);
  const loaded = useRef("");
  useEffect(() => {
    if (!viewer) return;
    let live = true;
    // The previous list stays on screen (aria-busy) while a tab or page loads.
    setLoading(true);
    setError("");
    Promise.all([
      api<IntentListDto>(`?scope=${scope}&page=${page}`),
      api<{ preferences: IntentPreferencesDto }>("/preferences"),
    ])
      .then(([list, prefs]) => {
        if (!live) return;
        startTransition(() => {
          setData({ ...list, scope });
          setPreferences(prefs.preferences);
          // Do not overwrite unsaved tile edits on a list refresh.
          const snapshot = JSON.stringify(prefs.preferences.passport || {});
          setPrefDraft((d) =>
            d === null || JSON.stringify(d) === loaded.current
              ? prefs.preferences.passport || {}
              : d,
          );
          loaded.current = snapshot;
        });
      })
      .catch((e) => {
        if (live) setError(errorMessage(e));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [viewer, scope, page, revision]);
  // «Хочу кататься» of a guest leads here with ?new=1 (#264): once signed in
  // they get the same «Новое намерение» window a member opens on the home
  // page. The parameter goes, so a reload does not open it again.
  useEffect(() => {
    if (!viewer) return;
    const url = new URL(location.href);
    if (url.searchParams.get("new") !== "1") return;
    url.searchParams.delete("new");
    history.replaceState(history.state, "", url.pathname + url.search);
    setDraft(
      intentDraft("custom", null, false, userTimeZone(personalSettings)),
    );
  }, [viewer, personalSettings]);
  if (!viewer)
    return (
      <AuthPage
        onAuthenticated={() => {
          // A new session must reload the server viewer; ?new=1 survives.
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          location.assign("/ride-intents" + location.search);
        }}
      />
    );
  function open(kind = "custom", item: IntentDto | null = null, edit = false) {
    setDraft(intentDraft(kind, item, edit, userTimeZone(personalSettings)));
  }
  const prefDirty =
    prefDraft !== null &&
    JSON.stringify(prefDraft) !== JSON.stringify(preferences.passport || {});
  async function savePreferences() {
    setPrefBusy(true);
    setPrefError("");
    setPrefMessage("");
    try {
      const result = await api<{ preferences: IntentPreferencesDto }>(
        "/preferences",
        "PUT",
        {
          passport: prefDraft,
          ...(preferences.meetNewPeople === undefined
            ? {}
            : { meetNewPeople: preferences.meetNewPeople }),
        },
      );
      setPreferences(result.preferences);
      loaded.current = JSON.stringify(result.preferences.passport || {});
      setPrefMessage(
        "Постоянные предпочтения сохранены только для вас. Намерение не создано.",
      );
    } catch (e) {
      setPrefError(errorMessage(e));
    } finally {
      setPrefBusy(false);
    }
  }
  async function action(item: IntentDto, remove: boolean) {
    if (
      !(await ask(
        remove
          ? "Удалить намерение и его расписание?"
          : "Отменить намерение? Оно больше не будет видно сообществу.",
        {
          confirmLabel: remove ? "Удалить" : "Отменить намерение",
          danger: remove,
        },
      ))
    )
      return;
    setBusy(true);
    setError("");
    try {
      await api(
        "/" + item.id + (remove ? "" : "/cancel"),
        remove ? "DELETE" : "POST",
      );
      startTransition(() => {
        setData((d) =>
          d ? { ...d, items: d.items.filter((i) => i.id !== item.id) } : d,
        );
      });
      setRevision((v) => v + 1);
      setMessage(remove ? "Намерение удалено" : "Намерение отменено");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const shown = data?.scope === scope ? data : null;
  const empty = !loading && shown && shown.items.length === 0;
  return (
    <>
      <SocialHeader user={viewer} />
      <main className={"page " + styles.page}>
        <header className={styles.header}>
          <span className={styles.headerIcon} aria-hidden="true">
            <Bike size={22} />
          </span>
          <div className={styles.headerText}>
            <h1>Хочу кататься</h1>
            <p>
              Отметьте свободное время и условия поездки. Велосипед в гараже не
              нужен; участие в конкретной покатушке подтверждается отдельно.
            </p>
          </div>
          <Link className="text-link" href="/rides">
            Все покатушки
          </Link>
        </header>
        <section className={styles.setup} aria-labelledby="when-heading">
          <div className={styles.setupHead}>
            <span className={styles.roundIcon} aria-hidden="true">
              <CalendarDays size={18} />
            </span>
            <div>
              <h2 id="when-heading">Новое намерение</h2>
              <p className="help">
                Конкретный раз: когда и где хочется покататься. До 5 активных
                намерений на ближайшие 90 дней, по умолчанию только для вас.
              </p>
            </div>
          </div>
          <div className={styles.whenActions}>
            {[
              ["tonight", "Сегодня вечером"],
              ["weekend", "В выходные"],
              ["custom", "Выбрать время"],
            ].map(([key, label]) => (
              <button
                className={key === "custom" ? "button" : "button secondary"}
                key={key}
                onClick={() => open(key)}
              >
                <Plus size={16} aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
        </section>
        <section className={styles.setup} aria-labelledby="prefs-heading">
          <div className={styles.setupHead}>
            <span className={styles.roundIcon} aria-hidden="true">
              <SlidersHorizontal size={18} />
            </span>
            <div>
              <h2 id="prefs-heading">Постоянные предпочтения</h2>
              <p className="help">
                Надолго и без времени: видны только вам. Подставляются в новое
                намерение по кнопке и сами намерение не создают.
              </p>
            </div>
            <button
              className="button secondary"
              disabled={!prefDirty || prefBusy}
              aria-busy={prefBusy}
              onClick={savePreferences}
            >
              {prefBusy ? "Сохраняем…" : "Сохранить предпочтения"}
            </button>
          </div>
          <PassportTiles
            value={prefDraft || {}}
            disabled={prefDraft === null || prefBusy}
            label="Постоянные предпочтения"
            onChange={(next) => {
              setPrefMessage("");
              setPrefDraft(next);
            }}
          />
          {prefMessage && (
            <p className="notice" data-tone="success" role="status">
              {prefMessage}
            </p>
          )}
          {prefError && (
            <p className="error" role="alert">
              {prefError}
            </p>
          )}
        </section>
        <div className={styles.listBar}>
          <div className="ui-tabs" role="group" aria-label="Намерения">
            {[
              ["own", "Мои намерения"],
              ["community", "Сообщество"],
            ].map(([key, label]) => (
              <button
                key={key}
                aria-pressed={scope === key}
                onClick={() => {
                  if (key === scope) return;
                  setScope(key);
                  setPage(1);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            className="quiet"
            disabled={loading}
            aria-busy={loading}
            onClick={() => setRevision((v) => v + 1)}
          >
            <RefreshCw size={14} aria-hidden="true" /> Обновить
          </button>
        </div>
        {message && (
          <p className="notice" role="status">
            <Check ref={saved} size={16} /> {message}
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}{" "}
            <button className="quiet" onClick={() => setRevision((v) => v + 1)}>
              Повторить загрузку
            </button>
          </p>
        )}
        <div className={styles.workspace}>
          <div className={styles.results}>
            {loading && !shown && (
              <p className="help" role="status">
                Загружаем намерения…
              </p>
            )}
            {empty ? (
              <div className={styles.empty}>
                <IntentIllustration />
                <p>
                  <strong>
                    {scope === "own"
                      ? "Пока нет намерений. Выберите время, когда хочется кататься."
                      : "Пока нет открытых намерений с будущими окнами."}
                  </strong>
                </p>
                {scope === "own" && (
                  <p className="help">
                    Сохранённые предпочтения подставляются только по вашему
                    действию. Они не создают намерения и не включают
                    уведомления.
                  </p>
                )}
              </div>
            ) : (
              <MotionList>
                <div className={styles.list} aria-busy={loading}>
                  {shown?.items.map((item) => (
                    <IntentCard
                      key={item.id}
                      item={item}
                      busy={busy}
                      onEdit={(item) => open("custom", item, true)}
                      onRepeat={(item) => open("custom", item)}
                      onAction={action}
                    />
                  ))}
                </div>
              </MotionList>
            )}
            {shown && (shown.pages || 0) > 1 && (
              <div className="form-actions">
                <button
                  className="button secondary"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Назад
                </button>
                <span>
                  {page} / {shown.pages}
                </span>
                <button
                  className="button secondary"
                  disabled={page >= shown.pages || loading}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Далее
                </button>
              </div>
            )}
          </div>
          <aside className={styles.how} aria-labelledby="how-heading">
            <h2 id="how-heading">Как это работает</h2>
            <ol>
              {howSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </aside>
        </div>
      </main>
      <SocialFooter />
      {draft && (
        <IntentComposer
          initial={draft}
          preferences={preferences}
          onPreferences={(next) => {
            setPreferences(next);
            setPrefDraft(next.passport || {});
            loaded.current = JSON.stringify(next.passport || {});
          }}
          onClose={() => setDraft(null)}
          onSaved={() => {
            setDraft(null);
            setMessage("Намерение сохранено");
            setScope("own");
            setPage(1);
            setRevision((v) => v + 1);
          }}
        />
      )}
      {confirmation}
    </>
  );
}
