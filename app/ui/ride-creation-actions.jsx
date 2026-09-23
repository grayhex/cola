"use client";
import Link from "next/link";
import SiteEmoji from "./site-emoji.jsx";
import styles from "./ride-creation-actions.module.css";

// Public rides and the account use the same two entry points. CSV always
// represents a completed ride, never another kind of future plan.
export default function RideCreationActions({ onSelect, disabled = false, mode = null }) {
  const action = (kind, text, icon) => onSelect ? (
    <button type="button" className="button secondary" disabled={disabled}
      aria-pressed={mode === kind} onClick={() => onSelect(kind)}>
      <SiteEmoji name={icon} />{text}
    </button>
  ) : (
    <Link className="button secondary" href={`/account?tab=rides&action=${kind}`}>
      <SiteEmoji name={icon} />{text}
    </Link>
  );
  return (
    <section className={styles.creation} aria-label="Добавление покатушек">
      <div className={styles.primary}>
        <div className={styles.group}>
          <span className={styles.caption}>Прошедшая поездка</span>
          {action("add", "Добавить покатушку", "addRide")}
        </div>
        <div className={styles.group}>
          <span className={styles.caption}>Будущая поездка</span>
          {action("plan", "Запланировать", "plan")}
        </div>
      </div>
      <div className={styles.imports} aria-label="Импорт прошедших покатушек">
        <span>Загрузить прошлые поездки:</span>
        {onSelect ? (
          <button type="button" className="quiet" disabled={disabled} aria-pressed={mode === "import"}
            onClick={() => onSelect("import")}><SiteEmoji name="import" />Импорт Garmin CSV</button>
        ) : (
          <Link className="quiet" href="/account?tab=rides&action=import"><SiteEmoji name="import" />Импорт Garmin CSV</Link>
        )}
        <button className={styles.soon} type="button" disabled title="Импорт Magene ещё не доступен">Magene CSV · скоро</button>
        <button className={styles.soon} type="button" disabled title="Импорт Bryton ещё не доступен">Bryton CSV · скоро</button>
      </div>
    </section>
  );
}
