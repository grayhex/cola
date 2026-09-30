import type { PassportDraft, PassportChoiceKey } from "./ride-types.ts";
import type { Range } from "../../lib/ride-match-core.ts";
import { ridePlanOptions } from "../../lib/ride-plan-options.ts";
import { AreaPreview } from "./ride-area-map.tsx";
import styles from "./ride-passport.module.css";
const rangeText = (v: Partial<Range> | undefined, unit: string) =>
  v?.min !== undefined && v?.max !== undefined
    ? `${v.min === v.max ? v.min : `${v.min}–${v.max}`} ${unit}`
    : null;
// `map` shows the coarse area circle; only detail pages opt in, lists never
// load tiles per card.
export default function RidePassport({
  passport = {},
  compact = false,
  map = false,
  region = true,
}: {
  passport?: PassportDraft;
  compact?: boolean;
  map?: boolean;
  region?: boolean;
}) {
  const labels = {
    purpose: "Цель",
    pace: "Темп",
    surface: "Покрытие",
    difficulty: "Сложность",
    regroupPolicy: "Ожидание",
  };
  const rows: [string, string | null | undefined][] = Object.entries(
    labels,
  ).map(([key, label]) => [
    label,
    Object.entries(ridePlanOptions[key as PassportChoiceKey]).find(
      ([option]) => option === passport[key as PassportChoiceKey],
    )?.[1],
  ]);
  rows.push(
    ["Дистанция", rangeText(passport.distanceKm, "км")],
    ["С остановками", rangeText(passport.durationMinutes, "мин")],
    ["Компания", rangeText(passport.groupSize, "чел.")],
    ["Скорость в движении", rangeText(passport.speedKmh, "км/ч")],
    [
      "Новичкам",
      passport.beginnerFriendly === undefined
        ? null
        : passport.beginnerFriendly
          ? "Подходит"
          : "Нужен опыт",
    ],
  );
  const known = rows.filter(([, value]) => value);
  const Wrapper = region ? "section" : "div";
  return (
    // Lists of several cards pass region={false}: one landmark per card
    // would repeat the same name (axe landmark-unique).
    <Wrapper
      className={styles.passport}
      {...(region ? { "aria-label": "Паспорт поездки" } : {})}
    >
      {passport.area?.label && (
        <p className={styles.area}>
          {passport.area.label}
          {passport.area.center && (
            <small>
              {" "}
              · область около {Number(passport.area.radiusM) / 1000} км
            </small>
          )}
        </p>
      )}
      {map && passport.area?.center && <AreaPreview area={passport.area} />}
      {!known.length && !passport.area?.label ? (
        <p className="help">Организатор пока не уточнил условия.</p>
      ) : (
        <dl className={styles.metadata}>
          {(compact ? known.slice(0, 4) : known).map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {compact && known.length > 4 && (
        <small className="help">
          Ещё {known.length - 4} условий в подробностях
        </small>
      )}
    </Wrapper>
  );
}
