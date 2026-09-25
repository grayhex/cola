"use client";
import SiteIcon from "./site-icon.jsx";
import SearchBox from "./search-box.jsx";
import styles from "./compact-ui.module.css";
import { useEffect, useRef, useState } from "react";
import {
  significantBadge,
  metricSegments,
} from "../../lib/card-presentation.js";
import {
  X,
  SlidersHorizontal,
  Search,
  CheckCheck,
  Zap,
  Medal,
  Trophy,
} from "./icons.jsx";
import { publicPath } from "../../lib/public-urls.js";

export function CompactIconButton({
  label,
  children,
  className = "",
  ...props
}) {
  return (
    <button
      type="button"
      className={"icon " + className}
      aria-label={label}
      title={label}
      {...props}
    >
      {children}
    </button>
  );
}
export function CompactDialog({
  open,
  onClose,
  title,
  children,
  className = "",
}) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = before;
    };
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={"sheet " + className}
      aria-label={title}
      onCancel={onClose}
      onClose={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.defaultPrevented) {
          e.preventDefault();
          onClose();
        }
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <div className="sheet-head">
        <h2>{title}</h2>
        <CompactIconButton label="Закрыть панель" onClick={onClose}>
          <X size={18} />
        </CompactIconButton>
      </div>
      {children}
    </dialog>
  );
}
export function FilterControl({ categories, selected, onChange }) {
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState(selected);
  return (
    <>
      <button
        type="button"
        className="button secondary"
        aria-label="Фильтры"
        title="Фильтры"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setDraft(selected);
          setOpen(true);
        }}
      >
        <SiteIcon name="filters" />
        <span className="control-label">Фильтры</span>
        {selected.length > 0 && (
          <span className="badge">{selected.length}</span>
        )}
      </button>
      <CompactDialog open={open} onClose={() => setOpen(false)} title="Фильтры">
        <fieldset className="filter-group">
          <legend>Тип велосипеда</legend>
          <div className="filter-options">
            {Object.entries(categories).map(([key, label]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={draft.includes(key)}
                  onChange={(e) =>
                    setDraft(
                      e.target.checked
                        ? [...draft, key]
                        : draft.filter((k) => k !== key),
                    )
                  }
                />
                <span>
                  <SiteIcon name={key} />
                  {label}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="sheet-actions">
          <button
            type="button"
            className="button secondary small"
            onClick={() => setDraft([])}
          >
            <SiteIcon name="reset" />
            Сбросить
          </button>
          <button
            type="button"
            className="button small"
            onClick={() => {
              onChange(draft);
              setOpen(false);
            }}
          >
            <SiteIcon name="apply" />
            Применить
          </button>
        </div>
      </CompactDialog>
    </>
  );
}
export function FilterChips({
  categories,
  selected,
  onChange,
  query = "",
  onClearSearch,
}) {
  return selected.length || query ? (
    <div className="filter-chips" aria-label="Активные фильтры">
      {selected.map((key) => (
        <button
          key={key}
          onClick={() => onChange(selected.filter((k) => k !== key))}
          aria-label={"Убрать фильтр " + categories[key]}
        >
          {categories[key]}
          <X size={12} />
        </button>
      ))}
      {query && (
        <button onClick={onClearSearch} aria-label="Сбросить поиск">
          Поиск: {query}
          <X size={12} />
        </button>
      )}
    </div>
  ) : null;
}
export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const key = (e) => {
      if (e.target.closest('input,textarea,select,[contenteditable="true"]'))
        return;
      if (
        e.key === "/" ||
        ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k")
      ) {
        e.preventDefault();
        const hero = document.querySelector("[data-home-search] input");
        if (hero) hero.focus();
        else setOpen(true);
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
  return (
    <>
      <button
        className="global-nav-item search-trigger"
        type="button"
        aria-label="Поиск ColaBike"
        title="Поиск · Ctrl/⌘ K"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <SiteIcon name="search" size={18} />
        <span className="search-trigger-label" aria-hidden="true">
          Поиск
        </span>
        <kbd aria-hidden="true">⌘K</kbd>
      </button>
      <CompactDialog
        title="Поиск ColaBike"
        open={open}
        onClose={() => setOpen(false)}
        className={"global-search-panel " + styles.searchDialog}
      >
        {open && (
          <SearchBox contained autoFocus onNavigate={() => setOpen(false)} />
        )}
        <p className="help">
          Велосипеды, компоненты и покатушки. Только публичные материалы.
        </p>
      </CompactDialog>
    </>
  );
}
export function MicroMetrics({ scores }) {
  const [open, setOpen] = useState(false);
  const metrics = [
    ["Заполненность", scores?.completeness || 0, CheckCheck, "complete"],
    ["Прокаченность", scores?.upgrade ?? 50, Zap, "upgrade"],
  ];
  return (
    <>
      <div className="micro-metrics">
        {metrics.map(([label, value, Icon, kind]) => (
          <button
            key={kind}
            type="button"
            className={"micro-metric " + kind}
            title={label + ": " + value + "%"}
            aria-label={label + ": " + value + "% — подробнее"}
            onClick={() => setOpen(true)}
          >
            <Icon size={14} />
            <span className="micro-segments" aria-hidden="true">
              {[0, 1, 2, 3].map((n) => (
                <i key={n} data-filled={n < metricSegments(value)} />
              ))}
            </span>
          </button>
        ))}
      </div>
      <CompactDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Показатели велосипеда"
      >
        <dl className="metric-details">
          {metrics.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}%</dd>
            </div>
          ))}
        </dl>
        <p className="help">
          Заполненность учитывает фото и компоненты. Прокаченность — тип
          велосипеда и правила площадки. Подробности доступны в карточке и
          разделе рекордов.
        </p>
      </CompactDialog>
    </>
  );
}
export function ImportantBadge({ bike, records = [] }) {
  const chosen = significantBadge(bike, records);
  if (!chosen) return null;
  const Icon = chosen.holder ? Trophy : Medal;
  return (
    <a
      className="important-badge"
      title={chosen.name}
      aria-label={chosen.name}
      href={chosen.holder ? "/records#" + chosen.key : publicPath("bike", bike)}
    >
      <Icon size={12} />
      <span>{chosen.name}</span>
    </a>
  );
}
