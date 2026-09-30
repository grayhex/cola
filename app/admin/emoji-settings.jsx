"use client";
import { useState } from "react";
import { emojiSlots, customEmoji, noCustomEmojis } from "../../lib/ui-emoji.ts";
import SiteIcon from "../ui/site-icon.jsx";
// Interface icons are line icons; an emoji typed here replaces one of them
// everywhere at the same size. An empty field keeps the standard icon.
export default function EmojiSettings({
  value,
  onChange,
  colors = {},
  onColorChange,
}) {
  const [query, setQuery] = useState("");
  const settings = { emojis: value, iconColors: colors };
  return (
    <section className="admin-panel">
      <h2>Значки меню и действий</h2>
      <p className="help">
        По умолчанию везде линейные иконки. Впишите эмодзи, чтобы заменить
        значок в навигации, кнопках и фильтрах; пустое поле возвращает
        стандартную иконку. Цвет выделения применяется при наведении и выборе; в
        светлой теме он немного темнее, в тёмной — светлее. У эмодзи меняется
        фон выделения.
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
            <div className="emoji-setting-row" key={s.key}>
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
              <input
                type="color"
                aria-label={"Цвет выделения: " + s.label}
                value={colors[s.key] || "#7c5cff"}
                onChange={(e) =>
                  onColorChange({ ...colors, [s.key]: e.target.value })
                }
              />
              <button
                type="button"
                className="quiet"
                aria-label={"Сбросить цвет: " + s.label}
                disabled={!colors[s.key]}
                onClick={() => {
                  const next = { ...colors };
                  delete next[s.key];
                  onColorChange(next);
                }}
              >
                ↺
              </button>
            </div>
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
