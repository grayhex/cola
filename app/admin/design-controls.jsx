"use client";
import { useId } from "react";
import styles from "./design.module.css";

export function Field({ label, help, children }) {
  return <label className="field"><span>{label}</span>{children}{help && <small>{help}</small>}</label>;
}
export function Select({ label, value, onChange, options, disabled = false }) {
  return <Field label={label}><select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
    {options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
  </select></Field>;
}

// Controlled tabs with a single keyboard stop and linked, labelled panels.
export function SectionTabs({ label, items, value, onChange, children }) {
  const id = useId();
  return <div>
    <div className={styles.tabs} role="tablist" aria-label={label}>
      {items.map(([key, text], index) => <button key={key} type="button" role="tab"
        id={`${id}-tab-${key}`} aria-controls={`${id}-panel-${key}`} aria-selected={value === key}
        tabIndex={value === key ? 0 : -1} onClick={() => onChange(key)}
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
            : (index + (event.key === "ArrowRight" ? 1 : -1) + items.length) % items.length;
          onChange(items[next][0]);
          document.getElementById(`${id}-tab-${items[next][0]}`)?.focus();
        }}>{text}</button>)}
    </div>
    {items.map(([key]) => <div key={key} role="tabpanel" tabIndex={0}
      id={`${id}-panel-${key}`} aria-labelledby={`${id}-tab-${key}`} hidden={value !== key}
      className={styles.tabPanel}>{value === key ? children(key) : null}</div>)}
  </div>;
}

export function Pager({ page, pages, total, onChange, label = "Постраничная навигация" }) {
  return <nav className={styles.pager} aria-label={label}>
    <span role="status">Найдено: {total} · {page} / {pages}</span>
    <div><button type="button" className="quiet" disabled={page <= 1} onClick={() => onChange(page - 1)}>Назад</button>
      <button type="button" className="quiet" disabled={page >= pages} onClick={() => onChange(page + 1)}>Далее</button></div>
  </nav>;
}

export function Toggle({ label, checked, onChange }) {
  return <label className="admin-toggle"><span>{label}</span><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /></label>;
}
