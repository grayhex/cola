"use client";
import { defaultArticleTopics } from "../../lib/ui-emoji.js";
export default function ArticleTopicSettings({
  value = defaultArticleTopics,
  onChange,
}) {
  const set = (i, key, next) =>
    onChange(value.map((v, n) => (n === i ? { ...v, [key]: next } : v)));
  return (
    <section className="admin-panel">
      <h2>Темы базы знаний</h2>
      <p className="help">
        Рубрики и их эмодзи доступны авторам статей. Удаление рубрики не удаляет
        статьи.
      </p>
      {value.map((v, i) => (
        <div className="article-topic-row" key={v.id}>
          <label className="field">
            <span>Эмодзи рубрики</span>
            <input
              maxLength={24}
              value={v.emoji}
              onChange={(e) => set(i, "emoji", e.target.value)}
            />
          </label>
          <label className="field">
            <span>Название рубрики</span>
            <input
              maxLength={60}
              value={v.label}
              onChange={(e) => set(i, "label", e.target.value)}
            />
          </label>
          <button
            type="button"
            className="quiet"
            disabled={value.length === 1}
            onClick={() => onChange(value.filter((_, n) => n !== i))}
          >
            Удалить
          </button>
        </div>
      ))}
      <button
        type="button"
        className="hf-button"
        disabled={value.length >= 24}
        onClick={() =>
          onChange([
            ...value,
            {
              id: "topic-" + crypto.randomUUID().slice(0, 8),
              label: "Новая рубрика",
              emoji: "📖",
            },
          ])
        }
      >
        Добавить рубрику
      </button>
    </section>
  );
}
