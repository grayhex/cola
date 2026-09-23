"use client";
import styles from "./bike-fields.module.css";

export function FormerBikeField({ value = false, onChange, disabled = false }) {
  return (
    <div className={styles.ownership}>
      <label className={styles.check}>
        <input type="checkbox" checked={value === true} disabled={disabled}
          onChange={(event) => onChange(event.target.checked)} />
        Бывший велосипед
      </label>
      <p className="help">Раньше принадлежал вам. Велосипед останется в гараже, но для него нельзя добавлять новые покатушки. Существующая история сохранится.</p>
    </div>
  );
}
