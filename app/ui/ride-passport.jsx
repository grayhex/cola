import { ridePlanOptions } from "../../lib/ride-plan-options.js";
import styles from "./ride-passport.module.css";
const rangeText = (v, unit) =>
  v?.min !== undefined && v?.max !== undefined
    ? `${v.min === v.max ? v.min : `${v.min}–${v.max}`} ${unit}`
    : null;
export default function RidePassport({ passport = {}, compact = false }) {
  const labels = {
    purpose: "Цель",
    pace: "Темп",
    surface: "Покрытие",
    difficulty: "Сложность",
    regroupPolicy: "Ожидание",
  };
  const rows = Object.entries(labels).map(([key, label]) => [
    label,
    ridePlanOptions[key][passport[key]],
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
  return (
    <section className={styles.passport} aria-label="Паспорт поездки">
      {passport.area?.label && (
        <p className={styles.area}>
          {passport.area.label}
          {passport.area.center && (
            <small> · область около {passport.area.radiusM / 1000} км</small>
          )}
        </p>
      )}
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
    </section>
  );
}
