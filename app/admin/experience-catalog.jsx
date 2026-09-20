"use client";
import { useState } from "react";
import {
  mergeCatalog,
  defaultAliases,
  defaultPurposes,
} from "../../lib/experience-catalog.js";
export default function ExperienceCatalog({ value, onChange }) {
  const [rule, setRule] = useState({
      kind: "component",
      scope: "",
      alias: "",
      name: "",
    }),
    [error, setError] = useState("");
  const purposes = value.purposes || defaultPurposes,
    aliases = value.aliases || defaultAliases;
  const change = (key, v) => setRule((r) => ({ ...r, [key]: v }));
  return (
    <div className="experience-catalog">
      <h3>Назначения</h3>
      <p className="help">
        Небольшой набор, до 12 назначений. Выключение убирает вариант из новых
        форм, но сохраняет старые сборки и фильтры по ссылке.
      </p>
      {purposes.map((p, i) => (
        <div className="list-add" key={p.id}>
          <code>{p.id}</code>
          <input
            aria-label={"Название " + p.id}
            value={p.name}
            onChange={(e) =>
              onChange({
                ...value,
                purposes: purposes.map((x, j) =>
                  i === j ? { ...x, name: e.target.value } : x,
                ),
              })
            }
          />
          <label>
            <input
              type="checkbox"
              checked={p.enabled}
              onChange={(e) =>
                onChange({
                  ...value,
                  purposes: purposes.map((x, j) =>
                    i === j ? { ...x, enabled: e.target.checked } : x,
                  ),
                })
              }
            />
            Доступно
          </label>
        </div>
      ))}
      <button
        className="quiet"
        disabled={purposes.length >= 12}
        onClick={() => {
          let n = 1;
          while (purposes.some((p) => p.id === "purpose-" + n)) n++;
          onChange({
            ...value,
            purposes: [
              ...purposes,
              { id: "purpose-" + n, name: "Новое назначение", enabled: false },
            ],
          });
        }}
      >
        Добавить назначение
      </button>
      <h3>Варианты названий и объединение дублей</h3>
      <p className="help">
        Объединение сохраняет старое название как вариант поиска и убирает дубль
        из подсказок. Установки владельцев и исторические снимки не
        переписываются. Для модели велосипеда задайте марку, для детали —
        категорию: так одинаковые названия разных моделей не смешаются.
      </p>
      <div className="experience-filter-grid">
        <label className="field">
          <span>Справочник</span>
          <select
            aria-label="Справочник вариантов"
            value={rule.kind}
            onChange={(e) => change("kind", e.target.value)}
          >
            <option value="brand">Марка</option>
            <option value="model">Модель велосипеда</option>
            <option value="component">Модель компонента</option>
          </select>
        </label>
        <label className="field">
          <span>Марка / категория (необязательно)</span>
          <input
            value={rule.scope}
            onChange={(e) => change("scope", e.target.value)}
            maxLength={150}
          />
        </label>
        <label className="field">
          <span>Вариант или дубль</span>
          <input
            value={rule.alias}
            onChange={(e) => change("alias", e.target.value)}
            maxLength={150}
          />
        </label>
        <label className="field">
          <span>Основное название</span>
          <input
            value={rule.name}
            onChange={(e) => change("name", e.target.value)}
            maxLength={150}
          />
        </label>
      </div>
      <button
        className="quiet"
        disabled={!rule.alias.trim() || !rule.name.trim()}
        onClick={() => {
          setError("");
          onChange(
            mergeCatalog(value, {
              ...rule,
              alias: rule.alias.trim(),
              name: rule.name.trim(),
              scope: rule.scope.trim(),
            }),
          );
          setRule((r) => ({ ...r, alias: "", name: "" }));
        }}
      >
        Объединить / добавить вариант
      </button>
      {error && <p role="alert">{error}</p>}
      <p className="help">
        Изменения вступят в силу после сохранения справочника внизу страницы.
        Циклы и неоднозначные дубли отклоняются.
      </p>
      <ul className="alias-list">
        {aliases.map((a, i) => (
          <li key={i}>
            <span>
              {a.alias} → {a.name} <small>{a.scope || a.kind}</small>
            </span>
            <button
              className="quiet"
              aria-label={"Удалить вариант " + a.alias}
              onClick={() =>
                onChange({
                  ...value,
                  aliases: aliases.filter((_, j) => i !== j),
                })
              }
            >
              Убрать
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
