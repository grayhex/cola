"use client";
import { useEffect, useState } from "react";
import type { JsonData } from "../../lib/contracts.ts";
import type { bikeWeekPreview } from "../../lib/bike-week.ts";
import type { BikeWeekSettings } from "../../lib/bike-week-validation.ts";
import { bikeWeekStart } from "../../lib/bike-week-validation.ts";
import { socialApi } from "../ui/social-primitives.tsx";
import { errorMessage } from "../../lib/errors.ts";
import styles from "../ui/bike-week.module.css";
import BikeWeekPicker, { BikeWeekLabel } from "./bike-week-picker.tsx";
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
  const [manual, setManual] = useState(false);
  useEffect(() => {
    let active = true;
    setData(null);
    setBikeId("");
    setReason("");
    setManual(false);
    setError("");
    setMessage("");
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
  function decide(
    action: "override" | "skip" | "automatic",
    selectedId = bikeId,
  ) {
    void act(
      () =>
        socialApi("bike-week/decision", "PUT", {
          week,
          action,
          bikeId: action === "override" ? selectedId : null,
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
        <details>
          <summary>Настройки автоматического выбора</summary>
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
        </details>
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
          </p>
          {data.currentBike && (
            <section
              aria-label="Текущий велосипед недели"
              className={styles.preview}
            >
              <BikeWeekLabel bike={data.currentBike} />
              <p className="help">
                {(data.decision?.action === "override" &&
                  data.decision.bike_id === data.currentBike.id) ||
                data.current?.source === "override"
                  ? "Назначен администратором"
                  : "Автоматический выбор по баллам"}
              </p>
            </section>
          )}
          {data.decision && (
            <p className="help">
              Решение администратора:{" "}
              {data.decision.action === "skip"
                ? "пропустить неделю"
                : "ручное назначение"}
              . Причина: {data.decision.reason}
            </p>
          )}
          {data.decisionBike &&
            data.decisionBike.id !== data.currentBike?.id && (
              <section
                aria-label="Запланированный велосипед недели"
                className={styles.preview}
              >
                <BikeWeekLabel bike={data.decisionBike} />
              </section>
            )}
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
          <fieldset disabled={busy}>
            <legend>Решение администратора</legend>
            <label className="field">
              <span>Причина для журнала</span>
              <input
                minLength={3}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                aria-describedby="bike-week-reason-help"
              />
              <small id="bike-week-reason-help">
                Укажите причину перед назначением, пропуском недели или
                возвратом автоматики.
              </small>
            </label>
            <button
              type="button"
              className="button secondary"
              aria-expanded={manual}
              aria-controls="bike-week-manual"
              onClick={() => setManual((v) => !v)}
            >
              Назначить вручную
            </button>
            {manual && (
              <div id="bike-week-manual" className={styles.manual}>
                <BikeWeekPicker
                  key={week}
                  week={week}
                  value={bikeId}
                  onChange={setBikeId}
                  disabled={busy}
                />
                <details>
                  <summary>По ID · дополнительно</summary>
                  <label className="field">
                    <span>ID велосипеда для выбора</span>
                    <input
                      value={bikeId}
                      onChange={(e) => setBikeId(e.target.value)}
                    />
                  </label>
                </details>
                <button
                  className="button"
                  disabled={!bikeId || reason.trim().length < 3}
                  onClick={() => decide("override")}
                >
                  Назначить на неделю
                </button>
              </div>
            )}
            <h3>Кандидаты по автоматическим правилам</h3>
            <ul className={styles.candidates} aria-label="Кандидаты недели">
              {data.candidates.map((b) => (
                <li key={b.id}>
                  <div>
                    {b.bike ? (
                      <BikeWeekLabel bike={b.bike} />
                    ) : (
                      <strong>{b.name}</strong>
                    )}
                    <p className="help">
                      {b.score} баллов · лайки {b.likes} · реакции {b.reactions}{" "}
                      · обсуждение {b.participants}
                    </p>
                  </div>
                  <button
                    className="quiet"
                    aria-label={"Назначить " + b.name}
                    disabled={busy || reason.trim().length < 3}
                    onClick={() => decide("override", b.id)}
                  >
                    Назначить
                  </button>
                </li>
              ))}
            </ul>
            {!data.candidates.length && (
              <p className="help">Нет кандидатов с такими порогами.</p>
            )}
            <div className={styles.actions}>
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
