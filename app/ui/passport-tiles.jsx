"use client";
import { useRef, useState } from "react";
import {
  ChevronRight,
  Clock,
  Gauge,
  Mountain,
  Route,
  Target,
  Users,
} from "lucide-react";
import { CompactDialog } from "./compact-ui.jsx";
import { useMotionFeedback } from "./motion.jsx";
import { ridePlanOptions } from "../../lib/ride-plan-options.js";
import styles from "./passport-tiles.module.css";

// Option tiles for the shared ride passport (#243, rules of #230/#231): one
// control for the preferences section and the intent composer, editing the
// same passport object. Each tile opens a compact sheet, never a long form.
export const passportTiles = [
  {
    key: "purpose",
    label: "Цель",
    title: "Цель поездки",
    icon: Target,
    any: "Любая",
  },
  {
    key: "pace",
    label: "Темп",
    title: "Темп поездки",
    icon: Gauge,
    any: "Любой",
  },
  {
    key: "surface",
    label: "Покрытие",
    title: "Покрытие",
    icon: Mountain,
    any: "Любое",
  },
  {
    key: "distanceKm",
    label: "Дистанция",
    title: "Дистанция, км",
    icon: Route,
    any: "Любая",
    unit: "км",
    max: 1000,
    step: 0.1,
  },
  {
    key: "durationMinutes",
    label: "Длительность",
    title: "Длительность с остановками, мин",
    icon: Clock,
    any: "Любая",
    unit: "мин",
    max: 10080,
    step: 1,
  },
  {
    key: "groupSize",
    label: "Компания",
    title: "Размер компании, чел.",
    icon: Users,
    any: "Любая",
    unit: "чел.",
    max: 100,
    step: 1,
  },
];
export function tileValue(tile, passport = {}) {
  const v = passport[tile.key];
  if (v === undefined) return null;
  if (!tile.unit) return ridePlanOptions[tile.key][v] || null;
  return `${v.min === v.max ? v.min : `${v.min}–${v.max}`} ${tile.unit}`;
}
function Tile({ tile, passport, required, disabled, onOpen }) {
  const text = tileValue(tile, passport);
  const feedback = useMotionFeedback(text);
  const Icon = tile.icon;
  return (
    <button
      type="button"
      className={styles.tile}
      data-filled={!!text}
      data-required={required && !text ? "" : undefined}
      aria-haspopup="dialog"
      aria-label={`${tile.label}: ${text || (required ? "не выбрано, обязательно" : tile.any)}`}
      disabled={disabled}
      onClick={onOpen}
    >
      <span className={styles.icon} aria-hidden="true" ref={feedback}>
        <Icon size={16} />
      </span>
      <span className={styles.text}>
        <span className={styles.label}>{tile.label}</span>
        <span className={styles.value}>
          {text || (required ? "Выберите" : tile.any)}
        </span>
      </span>
      <ChevronRight size={16} aria-hidden="true" className={styles.chevron} />
    </button>
  );
}
function ChoiceEditor({ tile, value, required, onPick }) {
  const options = [
    ...(required ? [] : [["", "Не важно"]]),
    ...Object.entries(ridePlanOptions[tile.key]),
  ];
  return (
    <div className={styles.options} role="group" aria-label={tile.title}>
      {options.map(([key, label]) => (
        <button
          key={key}
          type="button"
          className={styles.option}
          aria-pressed={(value || "") === key}
          onClick={() => onPick(key || undefined)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
function RangeEditor({ tile, value, onPick }) {
  const [draft, setDraft] = useState({
    min: value?.min ?? "",
    max: value?.max ?? "",
  });
  const [error, setError] = useState("");
  // Not a <form>: the editor lives inside the composer form, and a nested
  // submit would bubble into it.
  function apply() {
    const min = Number(draft.min),
      max = Number(draft.max);
    if (draft.min === "" && draft.max === "") return onPick(undefined);
    if (draft.min === "" || draft.max === "")
      return setError("Укажите обе границы");
    if (!(min >= tile.step && max <= tile.max))
      return setError(`От ${tile.step} до ${tile.max} ${tile.unit}`);
    if (tile.step === 1 && !(Number.isInteger(min) && Number.isInteger(max)))
      return setError("Нужны целые числа");
    if (min > max)
      return setError("Нижняя граница не может быть больше верхней");
    onPick({ min, max });
  }
  return (
    <div
      className={styles.range}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
          e.preventDefault();
          apply();
        }
      }}
    >
      {["min", "max"].map((side) => (
        <label className="field" key={side}>
          <span>{side === "min" ? "От" : "До"}</span>
          <input
            aria-label={`${tile.title}: ${side === "min" ? "от" : "до"}`}
            type="number"
            inputMode="decimal"
            min={tile.step}
            max={tile.max}
            step={tile.step}
            value={draft[side]}
            aria-invalid={error ? "true" : undefined}
            onChange={(e) => {
              setError("");
              setDraft((d) => ({ ...d, [side]: e.target.value }));
            }}
          />
        </label>
      ))}
      {error && (
        <small className="field-error" role="alert">
          {error}
        </small>
      )}
      <div className="sheet-actions">
        <button
          type="button"
          className="button secondary small"
          onClick={() => onPick(undefined)}
        >
          Не важно
        </button>
        <button type="button" className="button small" onClick={apply}>
          Готово
        </button>
      </div>
    </div>
  );
}
/** @param {{value: object, onChange: (passport: object) => void,
 *   required?: string[], disabled?: boolean, label?: string}} props */
export default function PassportTiles({
  value = {},
  onChange,
  required = [],
  disabled = false,
  label = "Параметры поездки",
}) {
  const [open, setOpen] = useState(null);
  const returnTo = useRef(null);
  const tile = passportTiles.find((t) => t.key === open);
  function pick(next) {
    const passport = { ...value };
    if (next === undefined) delete passport[open];
    else passport[open] = next;
    onChange(passport);
    close();
  }
  function close() {
    setOpen(null);
    // The sheet is a separate top-layer dialog: give focus back to its tile.
    requestAnimationFrame(() => returnTo.current?.focus());
  }
  return (
    <>
      <div className={styles.frame}>
        <div className={styles.tiles} role="group" aria-label={label}>
          {passportTiles.map((t) => (
            <Tile
              key={t.key}
              tile={t}
              passport={value}
              required={required.includes(t.key)}
              disabled={disabled}
              onOpen={(e) => {
                returnTo.current = e.currentTarget;
                setOpen(t.key);
              }}
            />
          ))}
        </div>
      </div>
      <CompactDialog
        open={!!tile}
        onClose={close}
        title={tile?.title || ""}
        className={styles.sheet}
      >
        {tile &&
          (tile.unit ? (
            <RangeEditor
              key={tile.key}
              tile={tile}
              value={value[tile.key]}
              onPick={pick}
            />
          ) : (
            <ChoiceEditor
              tile={tile}
              value={value[tile.key]}
              required={required.includes(tile.key)}
              onPick={pick}
            />
          ))}
        {tile?.key === "durationMinutes" && (
          <p className="help">Всё время поездки, включая остановки.</p>
        )}
      </CompactDialog>
    </>
  );
}
