"use client";
import { useCallback, useEffect, useId, useState } from "react";
import type { Area } from "../../lib/ride-match-core.ts";
import { errorMessage } from "../../lib/errors.ts";
import AreaPicker from "./ride-area-map.tsx";

// The private area of "rides near me" (#343), on the same settings object the
// phone reads. It is a consent of its own: off until switched on here or on the
// phone, and not the public profile and not a published intention. Only the
// coarse cell of the district is kept, one at a time, and a phone's area lives
// a day; this block shows it, switches it off, picks a district by hand and
// forgets everything.

interface Nearby {
  available: boolean;
  enabled: boolean;
  source: "manual" | "device" | null;
  area: {
    label: string | null;
    center: [number, number];
    radiusM: number;
  } | null;
  expiresAt: string | null;
  expired: boolean;
  horizonDays: number;
  limits: { minRadiusM: number; maxRadiusM: number; deviceTtlHours: number };
}
class ApiProblem extends Error {
  declare code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}
async function call(
  method: "GET" | "PATCH" | "PUT" | "DELETE",
  path: string,
  options: { body?: unknown; etag?: string | null } = {},
): Promise<{ state: Nearby | null; etag: string | null }> {
  const response = await fetch("/api/v1/me/nearby" + path, {
    method,
    cache: "no-store",
    headers: {
      ...(options.body === undefined
        ? {}
        : { "Content-Type": "application/json" }),
      ...(options.etag ? { "If-Match": options.etag } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (response.status === 204) return { state: null, etag: null };
  const result = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new ApiProblem(
      result?.error?.message || "Не удалось сохранить настройки района",
      result?.error?.code || "error",
    );
  return { state: result as Nearby, etag: response.headers.get("ETag") };
}
const horizons = [7, 14, 30];
const dayText = new Intl.DateTimeFormat("ru", {
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
});

export default function AccountNearby() {
  const id = useId();
  const [state, setState] = useState<Nearby | null>(null),
    [etag, setEtag] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [attempt, setAttempt] = useState(0),
    [replace, setReplace] = useState(false);
  const [draft, setDraft] = useState<Area>({});
  const accept = useCallback(
    (result: { state: Nearby | null; etag: string | null }) => {
      setState(result.state);
      setEtag(result.etag);
    },
    [],
  );
  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setError("");
    call("GET", "")
      .then((result) => {
        if (!disposed) accept(result);
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

  async function run(
    action: () => Promise<{ state: Nearby | null; etag: string | null }>,
    done: string,
  ) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      accept(await action());
      setMessage(done);
      return true;
    } catch (e) {
      setError(errorMessage(e));
      // Another device changed it first: show it, then let the person decide again.
      if (e instanceof ApiProblem && e.code === "precondition_failed")
        setAttempt((n) => n + 1);
      if (e instanceof ApiProblem && e.code === "conflict") setReplace(true);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const saveArea = (replaceSource: boolean) =>
    run(
      () =>
        call("PUT", "/area", {
          etag,
          body: {
            source: "manual",
            center: draft.center,
            radiusM: draft.radiusM,
            label: draft.label?.trim() || null,
            ...(replaceSource ? { replaceSource: true } : {}),
          },
        }),
      "Район сохранён",
    ).then((saved) => {
      if (saved) {
        setReplace(false);
        setDraft({});
      }
    });

  if (loading)
    return (
      <div className="notification-policy" role="group" aria-busy="true">
        <h4>Поездки рядом</h4>
        <p className="help" role="status">
          Загрузка…
        </p>
      </div>
    );
  if (!state)
    return (
      <div className="notification-policy" role="group">
        <h4>Поездки рядом</h4>
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
          Повторить загрузку
        </button>
      </div>
    );

  const kmMin = state.limits.minRadiusM / 1000,
    kmMax = state.limits.maxRadiusM / 1000;
  const radii = [5, 10, 20, 30, 50, 100].filter(
    (km) => km >= kmMin && km <= kmMax,
  );
  const canSave = !!draft.center && !!draft.radiusM;
  return (
    <div
      className="notification-policy"
      role="group"
      aria-labelledby={id + "-title"}
    >
      <h4 id={id + "-title"}>Поездки рядом</h4>
      <p className="help">
        Отдельное согласие: пока вы его не включили, сайт и приложение не ищут
        поездки возле вас. Район — не часть профиля и не опубликованное
        намерение. Хранится один, последний, и только как центр ячейки примерно{" "}
        3 км: без истории мест и без точного адреса.
      </p>
      {!state.available && (
        <p className="notice" role="status">
          Поиск поездок рядом сейчас отключён администратором. Включить его
          нельзя, выключить — можно.
        </p>
      )}
      <label className="check">
        <input
          type="checkbox"
          checked={state.enabled}
          disabled={busy || (!state.available && !state.enabled)}
          onChange={(e) =>
            run(
              () =>
                call("PATCH", "", {
                  body: { enabled: e.target.checked },
                  etag,
                }),
              e.target.checked
                ? "Поиск поездок рядом включён"
                : "Поиск поездок рядом выключен",
            )
          }
        />
        <span>Показывать новые поездки рядом с моим районом</span>
      </label>

      <fieldset disabled={busy} className="notification-policy-block">
        <legend>Мой район</legend>
        {state.area ? (
          <>
            <p role="status">
              {state.source === "device"
                ? state.expired
                  ? "Район, подтверждённый телефоном, устарел и не используется."
                  : `Район подтверждён телефоном и действует до ${
                      state.expiresAt
                        ? dayText.format(new Date(state.expiresAt))
                        : "—"
                    }.`
                : "Район выбран вами вручную и действует, пока вы его не удалите."}{" "}
              {state.area.label ? `«${state.area.label}», ` : ""}радиус{" "}
              {state.area.radiusM / 1000} км.
            </p>
            <button
              type="button"
              className="button secondary small"
              onClick={() =>
                run(() => call("DELETE", "/area", { etag }), "Район удалён")
              }
            >
              Удалить район
            </button>
          </>
        ) : (
          <p className="help">
            Района нет. Выберите его ниже или подтвердите положение в
            приложении: оттуда район приходит только грубо и живёт{" "}
            {state.limits.deviceTtlHours} ч.
          </p>
        )}
      </fieldset>

      <form
        className="notification-policy-block"
        onSubmit={async (e) => {
          e.preventDefault();
          await saveArea(false);
        }}
      >
        <fieldset disabled={busy || !state.available}>
          <legend>Выбрать район вручную</legend>
          <label className="field">
            <span>Название района</span>
            <input
              value={draft.label ?? ""}
              maxLength={100}
              autoComplete="off"
              placeholder="Например, Сокольники"
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            />
          </label>
          <AreaPicker
            value={draft}
            radii={radii}
            disabled={busy || !state.available}
            onChange={setDraft}
          />
          <p className="help">
            Выберите район или парк, не дом: точка приводится к ячейке примерно
            3 км. Радиус — от {kmMin} до {kmMax} км.
          </p>
          {replace ? (
            <>
              <p role="alert" className="notice">
                Сейчас действует район, подтверждённый телефоном. Заменить его
                выбранным вручную?
              </p>
              <button
                type="button"
                className="button small"
                disabled={!canSave}
                onClick={() => saveArea(true)}
              >
                Заменить район с телефона
              </button>
            </>
          ) : (
            <button
              type="submit"
              className="button small"
              disabled={!canSave}
              aria-busy={busy}
            >
              Сохранить район
            </button>
          )}
        </fieldset>
      </form>

      <fieldset disabled={busy} className="notification-policy-block">
        <legend>На сколько дней вперёд</legend>
        <label className="field">
          <span>Искать поездки на ближайшие</span>
          <select
            value={state.horizonDays}
            onChange={(e) =>
              run(
                () =>
                  call("PATCH", "", {
                    body: { horizonDays: Number(e.target.value) },
                    etag,
                  }),
                "Срок поиска сохранён",
              )
            }
          >
            {[...new Set([...horizons, state.horizonDays])]
              .sort((a, b) => a - b)
              .map((days) => (
                <option key={days} value={days}>
                  {days} дн.
                </option>
              ))}
          </select>
        </label>
      </fieldset>

      <fieldset disabled={busy} className="notification-policy-block">
        <legend>Отказаться</legend>
        <p className="help">
          Удалит район, выключатель и настройки поиска целиком. Push о поездках
          рядом включается отдельно в настройках уведомлений.
        </p>
        <button
          type="button"
          className="button secondary small"
          onClick={() =>
            run(async () => {
              await call("DELETE", "");
              return call("GET", "");
            }, "Район и настройки удалены")
          }
        >
          Забыть всё и отказаться
        </button>
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
