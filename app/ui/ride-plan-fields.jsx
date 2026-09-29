"use client";
import { useState } from "react";
import { ridePlanOptions } from "../../lib/ride-plan-options.js";
import { useMotionFeedback } from "./motion.jsx";
import RidePassport from "./ride-passport.jsx";
import styles from "./ride-passport.module.css";

export default function RidePlanFields({
  value = {},
  onChange,
  disabled = false,
  intent = false,
}) {
  const [expanded, setExpanded] = useState(false);
  const reveal = useMotionFeedback(expanded, { reveal: true });
  const feedback = useMotionFeedback(value.pace);
  const set = (key, v) => {
    const next = { ...value };
    if (v === undefined || v === "") delete next[key];
    else next[key] = v;
    onChange(next);
  };
  const area = value.area || {};
  const select = (key, label) => (
    <label className="field" key={key}>
      <span>{label}</span>
      <select
        aria-label={label}
        value={value[key] || ""}
        onChange={(e) => set(key, e.target.value)}
      >
        <option value="">Не уточнено</option>
        {Object.entries(ridePlanOptions[key]).map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
  const range = (key, label, max, step = 1) => {
    const v = value[key] || {};
    return (
      <fieldset className={styles.range}>
        <legend>{label}</legend>
        {["min", "max"].map((side) => (
          <label className="field" key={side}>
            <span>{side === "min" ? "От" : "До"}</span>
            <input
              aria-label={`${label}: ${side === "min" ? "от" : "до"}`}
              type="number"
              min={step}
              max={max}
              step={step}
              value={v[side] ?? ""}
              required={v.min !== undefined || v.max !== undefined}
              onChange={(e) => {
                const next = { ...v };
                if (e.target.value === "") delete next[side];
                else next[side] = Number(e.target.value);
                set(key, Object.keys(next).length ? next : undefined);
              }}
            />
          </label>
        ))}
      </fieldset>
    );
  };
  return (
    <fieldset className={styles.composer} disabled={disabled}>
      <legend>Как поедем</legend>
      <label className="field">
        <span>Область поездки</span>
        <input
          required={intent}
          maxLength={100}
          placeholder="Например, Измайловский парк"
          value={area.label || ""}
          onChange={(e) =>
            set(
              "area",
              e.target.value ? { ...area, label: e.target.value } : undefined,
            )
          }
        />
        <small>
          {intent
            ? "Приблизительный район или парк, без домашнего адреса."
            : "Приблизительный район, без домашнего адреса. Точное место встречи задаётся отдельно."}
        </small>
      </label>
      <div className="ride-form-grid">
        {intent ? (
          <fieldset className={styles.pace}>
            <legend>Цель поездки</legend>
            <div className="segmented" role="group" aria-label="Цель поездки">
              {Object.entries(ridePlanOptions.purpose).map(([key, text]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={value.purpose === key}
                  onClick={() => set("purpose", key)}
                >
                  {text}
                </button>
              ))}
            </div>
          </fieldset>
        ) : (
          select("purpose", "Цель поездки")
        )}
        {select("surface", "Покрытие")}
      </div>
      <fieldset className={styles.pace} ref={feedback}>
        <legend>Темп</legend>
        <div className="ui-tabs" role="group" aria-label="Темп поездки">
          {[["", "Не уточнён"], ...Object.entries(ridePlanOptions.pace)].map(
            ([v, label]) => (
              <button
                key={v}
                type="button"
                aria-pressed={(value.pace || "") === v}
                onClick={() => set("pace", v)}
              >
                {label}
              </button>
            ),
          )}
        </div>
      </fieldset>
      <details onToggle={(e) => setExpanded(e.currentTarget.open)}>
        <summary>Дополнительные условия</summary>
        <div ref={reveal} className={styles.additional}>
          <div className="ride-form-grid">
            {range("distanceKm", "Дистанция, км", 1000, 0.1)}
            {range(
              "durationMinutes",
              "Общая длительность с остановками, мин",
              10080,
            )}
            {range("groupSize", "Желательный размер компании, чел.", 100)}
            {range(
              "speedKmh",
              "Скорость в движении без остановок, км/ч",
              60,
              0.1,
            )}
            {select("difficulty", "Техническая сложность")}
            {select("regroupPolicy", "Как ждём отстающих")}
            <label className="field">
              <span>Подходит новичкам</span>
              <select
                value={
                  value.beginnerFriendly === undefined
                    ? ""
                    : String(value.beginnerFriendly)
                }
                onChange={(e) =>
                  set(
                    "beginnerFriendly",
                    e.target.value === ""
                      ? undefined
                      : e.target.value === "true",
                  )
                }
              >
                <option value="">Не уточнено</option>
                <option value="true">Да</option>
                <option value="false">Нужен опыт</option>
              </select>
            </label>
          </div>
          <p className="help">
            Диапазоны — пожелания к поездке, не ограничения участия. Скорость
            указана в движении; общее время включает остановки.
          </p>
        </div>
      </details>
      <RidePassport passport={value} />
    </fieldset>
  );
}
