"use client";
import Link from "next/link";
import SiteIcon from "./site-icon.jsx";
import styles from "./ride-creation-actions.module.css";

// Discovery offers planning only; personal imports live in the account.
export default function RideCreationActions({
  onSelect,
  disabled = false,
  busy = false,
  mode = null,
}) {
  if (!onSelect)
    return (
      <Link className="button" href="/account?tab=rides&action=plan">
        <SiteIcon name="plan" />
        Запланировать покатушку
      </Link>
    );
  return (
    <div className={styles.creation}>
      <div className="ui-tabs" aria-label="Мои поездки и импорт">
        {[
          [null, "Мои поездки", "rides"],
          ["add", "Загрузить GPX / FIT / TCX", "addRide"],
          ["import", "Garmin CSV", "import"],
          ["plan", "Запланировать", "plan"],
        ].map(([kind, label, icon]) => (
          <button
            key={label}
            type="button"
            disabled={kind ? disabled : busy}
            aria-pressed={mode === kind}
            onClick={() => onSelect(kind)}
          >
            <SiteIcon name={icon} />
            {label}
          </button>
        ))}
      </div>
      <div className={styles.sync}>
        <span>
          Garmin Connect <small>· скоро</small>
        </span>
        <button
          className="quiet"
          type="button"
          disabled
          aria-describedby="garmin-sync-help"
        >
          <SiteIcon name="repeat" /> Синхронизировать
        </button>
        <small id="garmin-sync-help">
          Пока можно загрузить файл трека или Garmin CSV.
        </small>
      </div>
    </div>
  );
}
