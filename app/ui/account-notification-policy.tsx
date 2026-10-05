"use client";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { errorMessage } from "../../lib/errors.ts";
import { personName } from "../../lib/usernames.ts";

// When, from whom and about what a person is told (#341): quiet hours on their
// own clock, a pause, the people whose new plans and intents come, and what is
// muted. It is the same settings object the app reads, so a choice made here is
// the choice on the phone. None of it touches the bell inside the site: it
// governs the channels that interrupt (the letter, and the push to come).

type CircleMode = "friends" | "follows" | "selected" | "off";
interface Person {
  id: string;
  username: string;
  name: string;
  avatarUrl: string | null;
}
interface Mute {
  kind: "author" | "ride" | "discussion";
  id: string;
  label: string | null;
}
interface PolicySettings {
  timeZone: string | null;
  quietHours: {
    enabled: boolean;
    from: string;
    to: string;
    allowCancellations: boolean;
  };
  pausedUntil: string | null;
  circle: { mode: CircleMode; members: Person[] };
  considering: boolean;
  mutes: Mute[];
}
const circleLabels: Record<CircleMode, [string, string]> = {
  friends: ["Друзья", "взаимные подписки — по умолчанию"],
  follows: ["Все, на кого я подписан", "любой, кого вы читаете"],
  selected: ["Выбранные люди", "только те, кого вы добавите ниже"],
  off: ["Никто", "новые планы и намерения не приходят"],
};
const muteKinds: Record<Mute["kind"], string> = {
  author: "автор",
  ride: "покатушка",
  discussion: "обсуждение",
};
const pauses: [string, string, number][] = [
  ["hour", "На час", 3600_000],
  ["eight", "На 8 часов", 8 * 3600_000],
  ["day", "На сутки", 24 * 3600_000],
  ["three", "На 3 дня", 3 * 86400_000],
  ["week", "На неделю", 7 * 86400_000],
];

async function request(
  method: "GET" | "PATCH",
  body?: unknown,
): Promise<PolicySettings> {
  const response = await fetch("/api/v1/me/notification-settings", {
    method,
    cache: "no-store",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      result?.error?.message || "Не удалось сохранить настройки уведомлений",
    );
  return result as PolicySettings;
}
// The clock of the browser is the zone a person starts with.
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
function zones(current: string | null): string[] {
  const browser = browserZone();
  let list: string[];
  try {
    list = Intl.supportedValuesOf("timeZone");
  } catch {
    list = ["Europe/Moscow", "Europe/Kaliningrad", "Asia/Yekaterinburg"];
  }
  return [...new Set([current, browser, ...list].filter(Boolean) as string[])];
}
const label = (person: Person) =>
  personName({
    id: person.id,
    username: person.username,
    name: person.name,
    avatar: person.avatarUrl,
  });
const untilText = (value: string) =>
  new Date(value).toLocaleString("ru-RU", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });

export default function AccountNotificationPolicy() {
  const id = useId();
  const [settings, setSettings] = useState<PolicySettings | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [attempt, setAttempt] = useState(0);
  // Drafts of the two forms that save on a button.
  const [quiet, setQuiet] = useState({
      enabled: false,
      from: "22:00",
      to: "07:00",
      allowCancellations: false,
      timeZone: "",
    }),
    [circle, setCircle] = useState<{ mode: CircleMode; considering: boolean }>({
      mode: "friends",
      considering: false,
    }),
    [person, setPerson] = useState(""),
    [muted, setMuted] = useState("");

  const accept = useCallback((value: PolicySettings) => {
    setSettings(value);
    setQuiet({
      enabled: value.quietHours.enabled,
      from: value.quietHours.from,
      to: value.quietHours.to,
      allowCancellations: value.quietHours.allowCancellations,
      timeZone: value.timeZone ?? browserZone(),
    });
    setCircle({ mode: value.circle.mode, considering: value.considering });
  }, []);
  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setError("");
    request("GET")
      .then((value) => {
        if (!disposed) accept(value);
      })
      .catch((e) => {
        if (!disposed) setError(errorMessage(e));
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [attempt, accept]);
  const options = useMemo(
    () => zones(settings?.timeZone ?? null),
    [settings?.timeZone],
  );

  // One change at a time; the answer is the settings as they are now.
  async function change(
    body: unknown,
    done: string,
    onError?: () => void,
  ): Promise<boolean> {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      accept(await request("PATCH", body));
      setMessage(done);
      return true;
    } catch (e) {
      setError(errorMessage(e));
      onError?.();
      return false;
    } finally {
      setBusy(false);
    }
  }
  // A person by the name they go by: the circle and the mutes name ids.
  async function resolve(username: string): Promise<Person | null> {
    const name = username.trim().replace(/^@/, "");
    if (!name) return null;
    const response = await fetch("/api/v1/users/" + encodeURIComponent(name), {
      cache: "no-store",
    });
    if (!response.ok) {
      setError("Не нашли пользователя с таким именем");
      return null;
    }
    return (await response.json()) as Person;
  }

  if (loading)
    return (
      <p role="status" className="help">
        Загружаем настройки уведомлений…
      </p>
    );
  if (!settings)
    return (
      <>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button
          type="button"
          className="button secondary small"
          onClick={() => setAttempt((n) => n + 1)}
        >
          Повторить загрузку настроек
        </button>
      </>
    );
  const paused = settings.pausedUntil;
  const quietChanged =
    quiet.enabled !== settings.quietHours.enabled ||
    quiet.from !== settings.quietHours.from ||
    quiet.to !== settings.quietHours.to ||
    quiet.allowCancellations !== settings.quietHours.allowCancellations ||
    quiet.timeZone !== (settings.timeZone ?? browserZone());
  const circleChanged =
    circle.mode !== settings.circle.mode ||
    circle.considering !== settings.considering;

  return (
    <div
      className="notification-policy"
      aria-labelledby={id + "-title"}
      role="group"
    >
      <h4 id={id + "-title"}>Когда и от кого</h4>
      <p className="help">
        Это касается писем и push. Уведомления внутри сайта и приложения
        приходят всегда. Ничего из этого не включает письма и push: их включаете
        только вы.
      </p>

      <fieldset disabled={busy} className="notification-policy-block">
        <legend>Пауза</legend>
        {paused ? (
          <>
            <p role="status">
              Письма и push молчат до {untilText(paused)}. То, что придёт за это
              время, потом не пришлют.
            </p>
            <button
              type="button"
              className="button secondary small"
              onClick={() => change({ pausedUntil: null }, "Пауза снята")}
            >
              Снять паузу
            </button>
          </>
        ) : (
          <div className="notification-policy-row">
            {pauses.map(([key, label, ms]) => (
              <button
                key={key}
                type="button"
                className="button secondary small"
                onClick={() =>
                  change(
                    { pausedUntil: new Date(Date.now() + ms).toISOString() },
                    "Пауза поставлена",
                  )
                }
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </fieldset>

      <form
        className="notification-policy-block"
        onSubmit={async (e) => {
          e.preventDefault();
          await change(
            {
              timeZone: quiet.timeZone,
              quietHours: {
                enabled: quiet.enabled,
                from: quiet.from,
                to: quiet.to,
                allowCancellations: quiet.allowCancellations,
              },
            },
            "Тихие часы сохранены",
          );
        }}
      >
        <fieldset disabled={busy}>
          <legend>Тихие часы</legend>
          <label className="check">
            <input
              type="checkbox"
              checked={quiet.enabled}
              onChange={(e) =>
                setQuiet({ ...quiet, enabled: e.target.checked })
              }
            />
            <span>Не беспокоить письмами и push в это время</span>
          </label>
          <div className="notification-policy-row">
            <label className="field">
              <span>С</span>
              <input
                type="time"
                value={quiet.from}
                required
                onChange={(e) => setQuiet({ ...quiet, from: e.target.value })}
              />
            </label>
            <label className="field">
              <span>До</span>
              <input
                type="time"
                value={quiet.to}
                required
                onChange={(e) => setQuiet({ ...quiet, to: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Часовой пояс</span>
              <select
                value={quiet.timeZone}
                onChange={(e) =>
                  setQuiet({ ...quiet, timeZone: e.target.value })
                }
              >
                {options.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="help">
            Сообщение, которое придёт в это время, дождётся утра. Если его срок
            выйдет раньше, оно не придёт вовсе.
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={quiet.allowCancellations}
              onChange={(e) =>
                setQuiet({ ...quiet, allowCancellations: e.target.checked })
              }
            />
            <span>
              Сообщать об отмене подтверждённой покатушки, до которой меньше 12
              часов, даже в тихие часы
            </span>
          </label>
          <button
            type="submit"
            className="button small"
            disabled={!quietChanged}
            aria-busy={busy}
          >
            Сохранить тихие часы
          </button>
        </fieldset>
      </form>

      <form
        className="notification-policy-block"
        onSubmit={async (e) => {
          e.preventDefault();
          await change(
            { circle: { mode: circle.mode }, considering: circle.considering },
            "Круг сохранён",
          );
        }}
      >
        <fieldset disabled={busy}>
          <legend>Новые планы и намерения</legend>
          <p className="help">
            О чьих новых покатушках и намерениях покататься вам сообщать.
            Подписка и выбор не открывают чужого: вы узнаёте только о том, что и
            так видите.
          </p>
          {(Object.keys(circleLabels) as CircleMode[]).map((mode) => (
            <label key={mode} className="check">
              <input
                type="radio"
                name={id + "-circle"}
                checked={circle.mode === mode}
                onChange={() => setCircle({ ...circle, mode })}
              />
              <span>
                {circleLabels[mode][0]}
                <small> — {circleLabels[mode][1]}</small>
              </span>
            </label>
          ))}
          <label className="check">
            <input
              type="checkbox"
              checked={circle.considering}
              onChange={(e) =>
                setCircle({ ...circle, considering: e.target.checked })
              }
            />
            <span>Сообщать и о намерениях, которые автор отметил «думаю»</span>
          </label>
          <button
            type="submit"
            className="button small"
            disabled={!circleChanged}
            aria-busy={busy}
          >
            Сохранить круг
          </button>
        </fieldset>
      </form>

      {(settings.circle.mode === "selected" ||
        !!settings.circle.members.length) && (
        <fieldset disabled={busy} className="notification-policy-block">
          <legend>Выбранные люди</legend>
          {settings.circle.members.length ? (
            <ul className="notification-policy-list">
              {settings.circle.members.map((member) => (
                <li key={member.id}>
                  <span>{label(member)}</span>
                  <button
                    type="button"
                    className="quiet"
                    aria-label={"Убрать из круга: " + label(member)}
                    onClick={() =>
                      change(
                        { circle: { remove: [member.id] } },
                        "Человек убран из круга",
                      )
                    }
                  >
                    Убрать
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="help">Пока никого.</p>
          )}
          <form
            className="notification-policy-row"
            onSubmit={async (e) => {
              e.preventDefault();
              const found = await resolve(person);
              if (!found) return;
              if (
                await change(
                  { circle: { add: [found.id] } },
                  "Человек добавлен в круг",
                )
              )
                setPerson("");
            }}
          >
            <label className="field">
              <span>Добавить по имени пользователя</span>
              <input
                value={person}
                maxLength={64}
                autoComplete="off"
                placeholder="@username"
                onChange={(e) => setPerson(e.target.value)}
              />
            </label>
            <button
              type="submit"
              className="button secondary small"
              disabled={!person.trim()}
            >
              Добавить
            </button>
          </form>
        </fieldset>
      )}

      <fieldset disabled={busy} className="notification-policy-block">
        <legend>Заглушённое</legend>
        <p className="help">
          Авторы, покатушки и обсуждения, о которых письма и push молчат. На
          сайте эти уведомления остаются.
        </p>
        {settings.mutes.length ? (
          <ul className="notification-policy-list">
            {settings.mutes.map((mute) => (
              <li key={mute.kind + mute.id}>
                <span>
                  {mute.label || "Без названия"}{" "}
                  <small>({muteKinds[mute.kind]})</small>
                </span>
                <button
                  type="button"
                  className="quiet"
                  aria-label={
                    "Вернуть: " + (mute.label || muteKinds[mute.kind])
                  }
                  onClick={() =>
                    change(
                      { mutes: { remove: [{ kind: mute.kind, id: mute.id }] } },
                      "Уведомления возвращены",
                    )
                  }
                >
                  Вернуть
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="help">Ничего не заглушено.</p>
        )}
        <form
          className="notification-policy-row"
          onSubmit={async (e) => {
            e.preventDefault();
            const found = await resolve(muted);
            if (!found) return;
            if (
              await change(
                { mutes: { add: [{ kind: "author", id: found.id }] } },
                "Автор заглушён",
              )
            )
              setMuted("");
          }}
        >
          <label className="field">
            <span>Заглушить автора по имени пользователя</span>
            <input
              value={muted}
              maxLength={64}
              autoComplete="off"
              placeholder="@username"
              onChange={(e) => setMuted(e.target.value)}
            />
          </label>
          <button
            type="submit"
            className="button secondary small"
            disabled={!muted.trim()}
          >
            Заглушить
          </button>
        </form>
      </fieldset>

      <p role="status" className="help">
        {message}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
