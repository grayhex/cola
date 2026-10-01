"use client";
import { useState } from "react";
import { ridePlanOptions } from "../../lib/ride-plan-options.ts";
import { useMotionFeedback } from "./motion.tsx";
import RidePassport from "./ride-passport.jsx";
import AreaPicker from "./ride-area-map.jsx";
import PassportTiles from "./passport-tiles.tsx";
import styles from "./ride-passport.module.css";

// The ride passport's inputs as parts (#253): the planners place the area,
// the option tiles and the rare conditions in their own sections; the UI
// Kit and older screens use the whole set below.
const setter = (value, onChange) => (key, v) => {
  const next = { ...value };
  if (v === undefined || v === "") delete next[key];
  else next[key] = v;
  onChange(next);
};

/** The approximate area — a label and an optional circle on the map. */
export function AreaField({
  value = {},
  onChange,
  disabled = false,
  intent = false,
  label = "Область поездки",
}) {
  const set = setter(value, onChange);
  const area = value.area || {};
  return (
    <>
      <label className="field">
        <span>{label}</span>
        <input
          required={intent || !!area.center}
          disabled={disabled}
          maxLength={100}
          placeholder="Например, Измайловский парк"
          value={area.label || ""}
          onChange={(e) =>
            set(
              "area",
              e.target.value || area.center
                ? { ...area, label: e.target.value }
                : undefined,
            )
          }
        />
        <small>
          {intent
            ? "Приблизительный район или парк, без домашнего адреса."
            : "Приблизительный район, без домашнего адреса."}
        </small>
      </label>
      <AreaPicker
        value={area}
        disabled={disabled}
        onChange={(next) =>
          set("area", next.label || next.center ? next : undefined)
        }
      />
    </>
  );
}

/** Rare conditions: speed, difficulty, regrouping and beginners; plans also
 * edit the numeric ranges here when they are not shown as tiles. */
export function ExtraConditions({
  value = {},
  onChange,
  ranges = false,
  disabled = false,
  pick = ["speedKmh", "difficulty", "regroupPolicy", "beginnerFriendly"],
  help = true,
}) {
  const set = setter(value, onChange);
  const select = (key, label) => (
    <label className="field" key={key}>
      <span>{label}</span>
      <select
        aria-label={label}
        disabled={disabled}
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
      <fieldset className={styles.range} disabled={disabled}>
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
    <>
      <div className="ride-form-grid">
        {ranges && (
          <>
            {range("distanceKm", "Дистанция, км", 1000, 0.1)}
            {range(
              "durationMinutes",
              "Общая длительность с остановками, мин",
              10080,
            )}
            {range("groupSize", "Желательный размер компании, чел.", 100)}
          </>
        )}
        {pick.includes("speedKmh") &&
          range("speedKmh", "Скорость в движении без остановок, км/ч", 60, 0.1)}
        {pick.includes("difficulty") &&
          select("difficulty", "Техническая сложность")}
        {pick.includes("regroupPolicy") &&
          select("regroupPolicy", "Как ждём отстающих")}
        {pick.includes("beginnerFriendly") && (
          <label className="field">
            <span>Подходит новичкам</span>
            <select
              disabled={disabled}
              value={
                value.beginnerFriendly === undefined
                  ? ""
                  : String(value.beginnerFriendly)
              }
              onChange={(e) =>
                set(
                  "beginnerFriendly",
                  e.target.value === "" ? undefined : e.target.value === "true",
                )
              }
            >
              <option value="">Не уточнено</option>
              <option value="true">Да</option>
              <option value="false">Нужен опыт</option>
            </select>
          </label>
        )}
      </div>
      {help && (
        <p className="help">
          Диапазоны — пожелания к поездке, не ограничения участия. Скорость
          указана в движении; общее время включает остановки.
        </p>
      )}
    </>
  );
}

export default function RidePlanFields({
  value = {},
  onChange,
  disabled = false,
  intent = false,
}) {
  const [expanded, setExpanded] = useState(false);
  const reveal = useMotionFeedback(expanded, { reveal: true });
  return (
    <fieldset className={styles.composer} disabled={disabled}>
      <legend>Как поедем</legend>
      <AreaField
        value={value}
        onChange={onChange}
        disabled={disabled}
        intent={intent}
      />
      <PassportTiles
        value={value}
        onChange={onChange}
        required={intent ? ["purpose"] : []}
        disabled={disabled}
      />
      <details onToggle={(e) => setExpanded(e.currentTarget.open)}>
        <summary>Дополнительные условия</summary>
        <div ref={reveal} className={styles.additional}>
          <ExtraConditions
            value={value}
            onChange={onChange}
            disabled={disabled}
          />
        </div>
      </details>
      {!intent && <RidePassport passport={value} />}
    </fieldset>
  );
}
