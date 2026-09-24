"use client";
import { useState } from "react";
import { emojiSlots, customEmoji, noCustomEmojis } from "../../lib/ui-emoji.js";
import SiteIcon from "../ui/site-icon.jsx";
// Interface icons are line icons; an emoji typed here replaces one of them
// everywhere at the same size. An empty field keeps the standard icon.
export default function EmojiSettings({ value, onChange }) {
  const [query, setQuery] = useState("");
  const settings = { emojis: value };
  return (
    <section className="admin-panel">
      <h2>Значки меню и действий</h2>
      <p className="help">
        По умолчанию везде линейные иконки. Впишите эмодзи, чтобы заменить
        значок в навигации, кнопках и фильтрах; пустое поле возвращает
        стандартную иконку.
      </p>
      <label className="field">
        <span>Найти значок</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="emoji-settings-grid">
        {emojiSlots
          .filter((s) => s.label.toLowerCase().includes(query.toLowerCase()))
          .map((s) => (
            <label key={s.key}>
              <SiteIcon name={s.key} settings={settings} size={18} />
              <span>{s.label}</span>
              <input
                aria-label={"Эмодзи вместо значка: " + s.label}
                maxLength={24}
                placeholder="Иконка"
                value={customEmoji(value, s.key) ?? ""}
                onChange={(e) =>
                  onChange({ ...value, [s.key]: e.target.value })
                }
              />
            </label>
          ))}
      </div>
      <button
        type="button"
        className="quiet"
        onClick={() => onChange(noCustomEmojis)}
      >
        Вернуть стандартные значки
      </button>
    </section>
  );
}
