"use client";
import { useEffect, useState } from "react";
import type { JsonData } from "../../lib/contracts.ts";
import type { bikeWeekPreview } from "../../lib/bike-week.ts";
import type { BikeWeekSettings } from "../../lib/bike-week-validation.ts";
import { bikeWeekStart } from "../../lib/bike-week-validation.ts";
import { socialApi } from "../ui/social-primitives.tsx";
import { errorMessage } from "../../lib/errors.ts";
import styles from "../ui/bike-week.module.css";
type Preview = JsonData<Awaited<ReturnType<typeof bikeWeekPreview>>>;
const fields = [
  ["windowDays", "Окно активности, дней", 1, 90],
  ["minimumLikes", "Минимум лайков", 0, 100000],
  ["minimumReactions", "Минимум реакций", 0, 100000],
  ["minimumParticipants", "Минимум участников обсуждения", 0, 100000],
  ["likeWeight", "Вес лайка", 0, 100],
  ["reactionWeight", "Вес реакции", 0, 100],
  ["discussionWeight", "Вес участника обсуждения", 0, 100],
  ["minimumScore", "Минимальный итоговый балл", 0, 10000000],
  ["cooldownWeeks", "Перерыв между победами, недель", 0, 104],
] as const;
export default function BikeWeekAdmin() {
  const [week, setWeek] = useState(bikeWeekStart()),
    [data, setData] = useState<Preview | null>(null),
    [settings, setSettings] = useState<BikeWeekSettings | null>(null);
  const [bikeId, setBikeId] = useState(""),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    setData(null);
    socialApi<Preview>("bike-week/admin?week=" + week)
      .then((v) => {
        if (active) {
          setData(v);
          setSettings(v.settings);
        }
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      });
    return () => {
      active = false;
    };
  }, [week]);
  async function act(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
      const v = await socialApi<Preview>("bike-week/admin?week=" + week);
      setData(v);
      setSettings(v.settings);
      setMessage(message);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  function decide(action: "override" | "skip" | "automatic") {
    void act(
      () =>
        socialApi("bike-week/decision", "PUT", {
          week,
          action,
          bikeId: action === "override" ? bikeId : null,
          reason,
        }),
      "Решение на неделю сохранено",
    );
  }
  return (
    <section>
      <h2>Велосипед недели</h2>
      <p className="help">
        Понедельник, 00:00 по Москве. Не менее пяти категорий комплектации и
        обложка. Один человек учитывается один раз в каждом сигнале.
      </p>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {settings && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(
              () => socialApi("bike-week/settings", "PUT", settings),
              "Настройки сохранены",
            );
          }}
        >
          <fieldset disabled={busy}>
            <legend>Механика выбора</legend>
            <label className="ride-toggle">
              <input
                type="checkbox"
                checked={settings.enabled}
                onChange={(e) =>
                  setSettings({ ...settings, enabled: e.target.checked })
                }
              />
              Включить велосипед недели
            </label>
            <div className={styles.layout}>
              {fields.map(([key, label, min, max]) => (
                <label className="field" key={key}>
                  <span>{label}</span>
                  <input
                    type="number"
                    min={min}
                    max={max}
                    step={
                      key.endsWith("Weight") || key === "minimumScore"
                        ? "0.1"
                        : "1"
                    }
                    required
                    value={settings[key]}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        [key]: Number(e.target.value),
                      })
                    }
                  />
                </label>
              ))}
            </div>
            <button className="button">Сохранить настройки</button>
          </fieldset>
        </form>
      )}
      <h3>Расчёт и решение на неделю</h3>
      <label className="field">
        <span>Понедельник недели</span>
        <input
          type="date"
          value={week}
          disabled={busy}
          onChange={(e) => {
            if (e.target.value) setWeek(e.target.value);
          }}
        />
      </label>
      {data && (
        <>
          <p>
            Статус:{" "}
            {data.current
              ? {
                  selected: "выбран",
                  empty: "нет кандидатов",
                  skipped: "неделя пропущена",
                  invalid: "ожидает замены",
                }[data.current.status]
              : "ещё не выбран"}
            {data.current?.bike_id ? ` · ${data.current.bike_id}` : ""}
          </p>
          <p className="help">
            Предпросмотр использует сохранённые настройки. Текущий победитель
            сохраняется до конца недели. Ручной выбор обходит баллы и перерыв,
            но сохраняет требования публичности и право владельца отказаться.
          </p>
          <button
            className="quiet"
            disabled={busy || week !== bikeWeekStart()}
            onClick={() =>
              void act(
                () => socialApi("bike-week/run", "POST"),
                "Расчёт выполнен",
              )
            }
          >
            Запустить выбор текущей недели
          </button>
          <ul className={styles.candidates}>
            {data.candidates.map((b) => (
              <li key={b.id}>
                <div>
                  <strong>{b.name}</strong>
                  <p className="help">
                    {b.score} баллов · лайки {b.likes} · реакции {b.reactions} ·
                    обсуждение {b.participants}
                  </p>
                </div>
                <button
                  className="quiet"
                  disabled={busy}
                  onClick={() => setBikeId(b.id)}
                >
                  Выбрать {b.name}
                </button>
              </li>
            ))}
          </ul>
          {!data.candidates.length && (
            <p className="help">Нет кандидатов с такими порогами.</p>
          )}
          <fieldset disabled={busy}>
            <legend>Ручное решение</legend>
            <label className="field">
              <span>ID велосипеда для выбора</span>
              <input
                value={bikeId}
                onChange={(e) => setBikeId(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Причина для журнала</span>
              <input
                minLength={3}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <div className={styles.actions}>
              <button
                className="button"
                disabled={!bikeId || reason.trim().length < 3}
                onClick={() => decide("override")}
              >
                Назначить на неделю
              </button>
              <button
                className="quiet"
                disabled={reason.trim().length < 3}
                onClick={() => decide("skip")}
              >
                Пропустить неделю
              </button>
              <button
                className="quiet"
                disabled={reason.trim().length < 3}
                onClick={() => decide("automatic")}
              >
                Вернуть автоматический выбор
              </button>
            </div>
          </fieldset>
        </>
      )}
    </section>
  );
}
