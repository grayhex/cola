"use client";
import Link from "next/link";
import SiteIcon from "./site-icon.jsx";
import styles from "./ride-creation-actions.module.css";

// Public rides and the account use the same two entry points. CSV always
// represents a completed ride, never another kind of future plan.
export default function RideCreationActions({ onSelect, disabled = false, mode = null }) {
  const action = (kind, text, icon) => onSelect ? (
    <button type="button" className="button secondary" disabled={disabled}
      aria-pressed={mode === kind} onClick={() => onSelect(kind)}>
      <SiteIcon name={icon} />{text}
    </button>
  ) : (
    <Link className="button secondary" href={`/account?tab=rides&action=${kind}`}>
      <SiteIcon name={icon} />{text}
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
            onClick={() => onSelect("import")}><SiteIcon name="import" />Импорт Garmin CSV</button>
        ) : (
          <Link className="quiet" href="/account?tab=rides&action=import"><SiteIcon name="import" />Импорт Garmin CSV</Link>
        )}
        {/* FIT covers Garmin, Wahoo, Magene, Bryton, iGPSport and Coros: the
            regular upload form takes it and explains how to export it. */}
        {onSelect ? (
          <button type="button" className="quiet" disabled={disabled}
            onClick={() => onSelect("add")}><SiteIcon name="import" />Загрузить FIT</button>
        ) : (
          <Link className="quiet" href="/account?tab=rides&action=add"><SiteIcon name="import" />Загрузить FIT</Link>
        )}
      </div>
    </section>
  );
}
