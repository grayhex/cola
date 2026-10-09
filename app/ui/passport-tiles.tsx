"use client";
import type { MouseEventHandler } from "react";
import type { Range } from "../../lib/ride-match-core.ts";
import type { PassportDraft } from "./ride-types.ts";
type ChoiceKey = "purpose" | "pace" | "surface";
type RangeKey = "distanceKm" | "durationMinutes" | "groupSize";
type TileBase = {
  label: string;
  title: string;
  icon: typeof Target;
  any: string;
};
type ChoiceTile = TileBase & { key: ChoiceKey; unit?: never };
type RangeTile = TileBase & {
  key: RangeKey;
  unit: string;
  max: number;
  step: number;
};
type PassportTile = ChoiceTile | RangeTile;
import { useEffect, useRef, useState } from "react";
import {
  ChevronRight,
  Clock,
  Gauge,
  Mountain,
  Route,
  Target,
  Users,
} from "lucide-react";
import { CompactDialog } from "./compact-ui.tsx";
import { useMotionFeedback } from "./motion.tsx";
import { ridePlanOptions } from "../../lib/ride-plan-options.ts";
import styles from "./passport-tiles.module.css";

// Option tiles for the shared ride passport (#243, rules of #230/#231): one
// control for the preferences section and the intent composer, editing the
// same passport object. Each tile opens a compact sheet, never a long form.
export const passportTiles: PassportTile[] = [
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
export function tileValue(tile: PassportTile, passport: PassportDraft = {}) {
  const v = passport[tile.key];
  if (v === undefined) return null;
  if (tile.unit === undefined)
    return (
      Object.entries(ridePlanOptions[tile.key]).find(
        ([key]) => key === passport[tile.key],
      )?.[1] || null
    );
  const range = passport[tile.key]!;
  return `${range.min === range.max ? range.min : `${range.min}–${range.max}`} ${tile.unit}`;
}
function Tile({
  tile,
  passport,
  required,
  disabled,
  onOpen,
}: {
  tile: PassportTile;
  passport: PassportDraft;
  required: boolean;
  disabled: boolean;
  onOpen: MouseEventHandler<HTMLButtonElement>;
}) {
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
function ChoiceEditor({
  tile,
  value,
  required,
  onPick,
}: {
  tile: ChoiceTile;
  value?: string;
  required: boolean;
  onPick: (value: string | undefined) => void;
}) {
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
function RangeEditor({
  tile,
  value,
  onPick,
}: {
  tile: RangeTile;
  value?: Partial<Range>;
  onPick: (value: Range | undefined) => void;
}) {
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
      {(["min", "max"] as const).map((side) => (
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
/**/
export default function PassportTiles({
  value = {},
  onChange,
  required = [],
  disabled = false,
  label = "Параметры поездки",
}: {
  value?: PassportDraft;
  onChange: (passport: PassportDraft) => void;
  required?: string[];
  disabled?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState<ChoiceKey | RangeKey | null>(null);
  const returnTo = useRef<HTMLButtonElement | null>(null);
  const tile = passportTiles.find((t) => t.key === open);
  useEffect(() => {
    if (open) return;
    // CompactDialog's child effect has closed the native dialog. Restore once
    // for this state change; a queued native close event must not steal focus
    // after the user has already moved to the next field.
    returnTo.current?.focus({ preventScroll: true });
    returnTo.current = null;
  }, [open]);
  function pick(next: string | Range | undefined) {
    const passport = { ...value };
    if (!open) return;
    if (next === undefined) delete passport[open];
    else if (
      typeof next === "string" &&
      (open === "purpose" || open === "pace" || open === "surface")
    )
      passport[open] = next;
    else if (
      typeof next !== "string" &&
      (open === "distanceKm" ||
        open === "durationMinutes" ||
        open === "groupSize")
    )
      passport[open] = next;
    onChange(passport);
    close();
  }
  function close() {
    setOpen(null);
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
        placement="center"
      >
        {tile &&
          (tile.unit !== undefined ? (
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
