"use client";
import { useState } from "react";
import { emojiSlots, defaultEmojis } from "../../lib/ui-emoji.js";
export default function EmojiSettings({ value, onChange }) {
  const [query, setQuery] = useState("");
  return (
    <section className="admin-panel">
      <h2>Эмодзи меню и действий</h2>
      <p className="help">
        Общие значки для навигации, кнопок, фильтров и лейблов. Можно вставить
        эмодзи с клавиатуры.
      </p>
      <label className="field">
        <span>Найти эмодзи</span>
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
              <span>{s.label}</span>
              <input
                aria-label={"Эмодзи: " + s.label}
                maxLength={24}
                value={value?.[s.key] ?? s.emoji}
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
        onClick={() => onChange(defaultEmojis)}
      >
        Вернуть стандартные эмодзи
      </button>
    </section>
  );
}
