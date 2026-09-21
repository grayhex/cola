"use client";
import { useId, useState } from "react";
import { Eye, Pencil, MessageCircle } from "./icons.jsx";
import styles from "./prompt-composer.module.css";

// The same writing surface is used for posts, comments and replies.
export default function PromptComposer({
  label,
  value,
  onChange,
  maxLength,
  rows = 6,
  required = false,
  disabled = false,
  placeholder,
  children,
}) {
  const id = useId();
  const [preview, setPreview] = useState(false);
  return (
    <div className={styles.composer}>
      <div
        className={styles.toolbar}
        role="tablist"
        aria-label={"Режим редактора: " + label}
      >
        {[
          [false, "Написать", Pencil],
          [true, "Предпросмотр", Eye],
        ].map(([state, title, Icon], index) => (
          <button
            key={title}
            type="button"
            role="tab"
            id={`${id}-tab-${index}`}
            aria-selected={preview === state}
            aria-controls={`${id}-panel-${index}`}
            tabIndex={preview === state ? 0 : -1}
            onClick={() => setPreview(state)}
            onKeyDown={(event) => {
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return;
              event.preventDefault();
              const next =
                event.key === "Home" ? 0 : event.key === "End" ? 1 : 1 - index;
              setPreview(!!next);
              document.getElementById(`${id}-tab-${next}`)?.focus();
            }}
          >
            <Icon size={15} aria-hidden="true" />
            {title}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${id}-panel-0`}
        aria-labelledby={`${id}-tab-0`}
        hidden={preview}
      >
        <textarea
          aria-label={label}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          maxLength={maxLength}
          rows={rows}
          required={required && !preview}
          disabled={disabled}
          placeholder={
            placeholder || "Поделитесь историей, опытом или вопросом…"
          }
        />
      </div>
      <div
        role="tabpanel"
        id={`${id}-panel-1`}
        aria-labelledby={`${id}-tab-1`}
        hidden={!preview}
        className={styles.preview}
        tabIndex={0}
      >
        {value.trim() || (
          <span className={styles.empty}>
            <MessageCircle size={20} />
            Здесь появится ваш текст
          </span>
        )}
      </div>
      <div className={styles.footer}>
        <small>
          {value.length.toLocaleString("ru-RU")} /{" "}
          {maxLength.toLocaleString("ru-RU")}
        </small>
        {children}
      </div>
    </div>
  );
}
