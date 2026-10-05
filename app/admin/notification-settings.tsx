"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type * as React from "react";
import { errorMessage } from "../../lib/errors.ts";
import { Check, RefreshCw, Save, X } from "../ui/icons.tsx";
import { Field, Toggle } from "./design-controls.tsx";
import styles from "./notification-settings.module.css";

// The «Уведомления» group of the app settings (#341): the catalogue as the code
// has it, the limits and kill switches, why a person would or would not be told,
// and a test to oneself. Reads and writes are administrators' only; nothing here
// switches a consent on for a person, and the page never shows what anyone wrote.

interface Limits {
  discoveryPerDay: number;
  authorCooldownMinutes: number;
  announcementsPerAuthorDay: number;
  audienceMax: number;
  batch: number;
  enabled: boolean;
  externalEnabled: boolean;
  disabledCategories: string[];
}
interface Category {
  key: string;
  label: string;
  email: boolean;
  push: boolean;
  pushDefault: boolean;
}
interface State {
  catalog: {
    categories: Category[];
    planned: { key: string; label: string; issue: string }[];
    events: { type: string; category: string; email: boolean }[];
  };
  limits: Limits;
  version: number;
  updatedAt: string | null;
  channels: { email: { available: boolean }; push: { available: boolean } };
  status: {
    email: { status: string; count: number }[];
    fanouts: { status: string; count: number }[];
  };
}
interface Reason {
  code: string;
  ok: boolean | null;
  text: string;
}
interface Explanation {
  author: { username: string; name: string };
  recipient: { username: string; name: string };
  inbox: boolean;
  external: boolean;
  reasons: Reason[];
}
const statusText: Record<string, string> = {
  pending: "ждут",
  sending: "отправляются",
  sent: "отправлены",
  failed: "не удались",
  skipped: "пропущены",
  done: "разосланы",
  cancelled: "остановлены",
};

async function call<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method,
    cache: "no-store",
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(result.error || "Не удалось выполнить запрос");
  return result as T;
}
function NumberField({
  label,
  help,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string;
  help: React.ReactNode;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label} help={help}>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        value={Number.isFinite(value) ? value : ""}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </Field>
  );
}

export default function NotificationSettingsAdmin({
  active,
}: {
  active: boolean;
}) {
  const [state, setState] = useState<State | null>(null),
    [draft, setDraft] = useState<Limits | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [author, setAuthor] = useState(""),
    [recipient, setRecipient] = useState(""),
    [explained, setExplained] = useState<Explanation | null>(null),
    [explainError, setExplainError] = useState(""),
    [testNote, setTestNote] = useState(""),
    [testError, setTestError] = useState("");
  const loading = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await call<State>("/api/admin/notifications");
      if (!alive.current) return;
      setState(result);
      setDraft(result.limits);
    } catch (e) {
      if (alive.current)
        setError(errorMessage(e) || "Не удалось загрузить настройки");
    } finally {
      loading.current = false;
      if (alive.current) setBusy(false);
    }
  }, []);
  useEffect(() => {
    if (active && !state && !loading.current) load();
  }, [active, state, load]);

  if (!state || !draft)
    return (
      <section
        className={"admin-panel " + styles.panel}
        aria-labelledby="notification-admin-title"
      >
        <h2 id="notification-admin-title">Уведомления</h2>
        {error ? (
          <div className="error" role="alert">
            {error}
          </div>
        ) : (
          <p role="status">Загружаем настройки уведомлений…</p>
        )}
        <button type="button" className="quiet" disabled={busy} onClick={load}>
          <RefreshCw size={16} />
          Загрузить снова
        </button>
      </section>
    );
  const dirty = JSON.stringify(draft) !== JSON.stringify(state.limits);
  const edit = (change: Partial<Limits>) => {
    setDraft({ ...draft, ...change });
    setMessage("");
  };
  const toggleCategory = (key: string, off: boolean) =>
    edit({
      disabledCategories: off
        ? [...new Set([...draft.disabledCategories, key])]
        : draft.disabledCategories.filter((item) => item !== key),
    });
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!state || !draft) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await call<State>("/api/admin/notifications", "PUT", {
        version: state.version,
        discoveryPerDay: draft.discoveryPerDay,
        authorCooldownMinutes: draft.authorCooldownMinutes,
        announcementsPerAuthorDay: draft.announcementsPerAuthorDay,
        audienceMax: draft.audienceMax,
        batch: draft.batch,
        discoveryEnabled: draft.enabled,
        externalEnabled: draft.externalEnabled,
        disabledCategories: draft.disabledCategories,
      });
      setState(result);
      setDraft(result.limits);
      setMessage("Настройки уведомлений сохранены");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function explain(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setExplainError("");
    setExplained(null);
    try {
      setExplained(
        await call<Explanation>("/api/admin/notifications/explain", "POST", {
          author,
          recipient,
        }),
      );
    } catch (e) {
      setExplainError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function sendTest() {
    setBusy(true);
    setTestError("");
    setTestNote("");
    try {
      await call("/api/admin/notifications/test", "POST");
      setTestNote("Тестовое письмо отправлено на ваш адрес");
    } catch (e) {
      setTestError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className={"admin-panel " + styles.panel}
      aria-labelledby="notification-admin-title"
    >
      <div className={styles.heading}>
        <h2 id="notification-admin-title">Уведомления</h2>
        <button
          type="button"
          className="quiet"
          disabled={busy || dirty}
          onClick={() => {
            setState(null);
            setDraft(null);
          }}
        >
          <RefreshCw size={16} />
          Обновить
        </button>
      </div>
      <p className={styles.intro}>
        Согласие на письма и push даёт только сам человек: администратор его не
        включает и ничего не рассылает по списку. Здесь — каталог, пределы шума
        и выключатели на случай аварии. Уведомления на сайте и в приложении
        выключателями не затрагиваются.
      </p>
      <p className={styles.channels}>
        Почта: {state.channels.email.available ? "настроена" : "не настроена"}.
        Push:{" "}
        {state.channels.push.available ? "подключён" : "пока не подключён"}.
      </p>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {message && (
        <p className="notice" data-tone="success" role="status">
          <Check size={16} /> {message}
        </p>
      )}

      <form onSubmit={save} className={styles.form}>
        <h3 className={styles.subheading}>Пределы и выключатели</h3>
        <fieldset disabled={busy} className={styles.fields}>
          <legend className="sr-only">Пределы уведомлений</legend>
          <NumberField
            label="Предложений наружу на человека в сутки"
            help="Новые планы и намерения друзей, которые могут выйти за пределы сайта. Остальное остаётся на сайте. По умолчанию 3."
            value={draft.discoveryPerDay}
            min={0}
            max={20}
            disabled={busy}
            onChange={(value) => edit({ discoveryPerDay: value })}
          />
          <NumberField
            label="Пауза между предложениями одного автора, минут"
            help="После предложения от автора следующее от него остаётся на сайте. По умолчанию 360."
            value={draft.authorCooldownMinutes}
            min={0}
            max={10080}
            disabled={busy}
            onChange={(value) => edit({ authorCooldownMinutes: value })}
          />
          <NumberField
            label="Объявлений автора в сутки"
            help="Сколько планов и намерений автор может объявить за 24 часа. По умолчанию 10."
            value={draft.announcementsPerAuthorDay}
            min={1}
            max={100}
            disabled={busy}
            onChange={(value) => edit({ announcementsPerAuthorDay: value })}
          />
          <NumberField
            label="Получателей одного объявления"
            help="Предел рассылки одного объявления. По умолчанию 5000."
            value={draft.audienceMax}
            min={1}
            max={100000}
            disabled={busy}
            onChange={(value) => edit({ audienceMax: value })}
          />
          <NumberField
            label="Получателей за один проход воркера"
            help="Размер страницы рассылки. По умолчанию 200."
            value={draft.batch}
            min={1}
            max={1000}
            disabled={busy}
            onChange={(value) => edit({ batch: value })}
          />
        </fieldset>
        <Toggle
          label="События «новый план» и «намерение» друзей включены"
          checked={draft.enabled}
          onChange={(value) => edit({ enabled: value })}
        />
        <Toggle
          label="Письма и push отправляются (выключатель всех внешних каналов)"
          checked={draft.externalEnabled}
          onChange={(value) => edit({ externalEnabled: value })}
        />
        <fieldset disabled={busy} className={styles.categories}>
          <legend>Не отправлять наружу по категориям</legend>
          <p className="help">
            Категория выключается для писем и push; для планов и намерений ещё и
            не создаётся. Уведомление на сайте остаётся.
          </p>
          {state.catalog.categories
            .filter((category) => category.email || category.push)
            .map((category) => (
              <label key={category.key} className="check">
                <input
                  type="checkbox"
                  checked={draft.disabledCategories.includes(category.key)}
                  onChange={(e) =>
                    toggleCategory(category.key, e.target.checked)
                  }
                />
                <span>
                  {category.label} <code>{category.key}</code>
                </span>
              </label>
            ))}
        </fieldset>
        <div className={styles.actions}>
          <button type="submit" className="button" disabled={busy || !dirty}>
            <Save size={16} />
            Сохранить
          </button>
          {dirty && (
            <button
              type="button"
              className="quiet"
              disabled={busy}
              onClick={() => setDraft(state.limits)}
            >
              <X size={16} />
              Отменить изменения
            </button>
          )}
        </div>
      </form>

      <h3 className={styles.subheading}>Кому и почему</h3>
      <p className="help">
        Покажет, дойдёт ли новый план или намерение одного человека до другого,
        и что мешает: круг получателя, mute, пауза, лимит, выключатель. Только
        причины — ничего из написанного людьми. Запрос записывается в журнал.
      </p>
      <form className={styles.explain} onSubmit={explain}>
        <Field label="Автор (имя пользователя)">
          <input
            value={author}
            maxLength={64}
            autoComplete="off"
            onChange={(e) => setAuthor(e.target.value)}
          />
        </Field>
        <Field label="Получатель (имя пользователя)">
          <input
            value={recipient}
            maxLength={64}
            autoComplete="off"
            onChange={(e) => setRecipient(e.target.value)}
          />
        </Field>
        <button
          type="submit"
          className="button secondary"
          disabled={busy || !author.trim() || !recipient.trim()}
        >
          Разобрать
        </button>
      </form>
      {explainError && (
        <p className="error" role="alert">
          {explainError}
        </p>
      )}
      {explained && (
        <div className={styles.result} role="status">
          <p>
            <strong>
              {explained.author.name} → {explained.recipient.name}:
            </strong>{" "}
            {explained.inbox
              ? "на сайте уведомление будет"
              : "уведомления не будет"}
            {explained.inbox &&
              (explained.external
                ? ", наружу может выйти."
                : ", наружу не выйдет.")}
          </p>
          <ul>
            {explained.reasons.map((reason) => (
              <li key={reason.code} data-ok={String(reason.ok)}>
                <span aria-hidden="true">
                  {reason.ok === null ? "·" : reason.ok ? "✓" : "✗"}
                </span>
                <span className="sr-only">
                  {reason.ok === null
                    ? "не влияет: "
                    : reason.ok
                      ? "не мешает: "
                      : "мешает: "}
                </span>
                {reason.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      <h3 className={styles.subheading}>Тест себе</h3>
      <p className="help">
        Отправит одно тестовое письмо на подтверждённую почту вашего аккаунта и
        никому больше. Не больше пяти в 15 минут.
      </p>
      <div className={styles.actions}>
        <button
          type="button"
          className="button secondary"
          disabled={busy || !state.channels.email.available}
          onClick={sendTest}
        >
          Отправить тестовое письмо себе
        </button>
      </div>
      {!state.channels.email.available && (
        <p className="help">Отправка почты на сервере не настроена.</p>
      )}
      {testNote && (
        <p className="notice" data-tone="success" role="status">
          {testNote}
        </p>
      )}
      {testError && (
        <p className="error" role="alert">
          {testError}
        </p>
      )}

      <details className={styles.catalog}>
        <summary>Каталог категорий и событий</summary>
        <table>
          <caption className="sr-only">Категории уведомлений</caption>
          <thead>
            <tr>
              <th scope="col">Категория</th>
              <th scope="col">Письмо</th>
              <th scope="col">Push</th>
              <th scope="col">События</th>
            </tr>
          </thead>
          <tbody>
            {state.catalog.categories.map((category) => (
              <tr key={category.key}>
                <th scope="row">
                  {category.label} <code>{category.key}</code>
                </th>
                <td>{category.email ? "да" : "нет"}</td>
                <td>{category.push ? "да" : "нет"}</td>
                <td>
                  {state.catalog.events
                    .filter((event) => event.category === category.key)
                    .map((event) => event.type)
                    .join(", ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!!state.catalog.planned.length && (
          <p className="help">
            Запланированы, пока не производят событий:{" "}
            {state.catalog.planned
              .map((item) => `${item.label} (${item.issue})`)
              .join(", ")}
            .
          </p>
        )}
      </details>

      <h3 className={styles.subheading}>Очереди</h3>
      <p className={styles.queues}>
        Письма:{" "}
        {state.status.email.length
          ? state.status.email
              .map(
                (row) => `${statusText[row.status] ?? row.status} ${row.count}`,
              )
              .join(", ")
          : "очередь пуста"}
        . Рассылка объявлений:{" "}
        {state.status.fanouts.length
          ? state.status.fanouts
              .map(
                (row) => `${statusText[row.status] ?? row.status} ${row.count}`,
              )
              .join(", ")
          : "нет объявлений"}
        .
      </p>
    </section>
  );
}
