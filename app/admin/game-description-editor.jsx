"use client";
import { defaultGameDescription, gameDescriptionLimit } from "../../lib/gamification-presentation.js";
import styles from "./game-description-editor.module.css";

export default function GameDescriptionEditor({ definition, kind, value, onChange }) {
  const text = value || "";
  return (
    <div className={styles.editor}>
      <label className="field">
        <span>Короткое описание</span>
        <textarea
          aria-label={"Описание «" + definition.name + "»"}
          rows={2}
          maxLength={gameDescriptionLimit}
          value={text}
          placeholder={defaultGameDescription(kind, definition.key)}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      <div className={styles.note}>
        <small>Пустое поле — стандартный текст. {text.length}/{gameDescriptionLimit}</small>
        <button type="button" className="quiet" disabled={!text}
          aria-label={"Стандартное описание «" + definition.name + "»"}
          onClick={() => onChange("")}>
          По умолчанию
        </button>
      </div>
    </div>
  );
}
