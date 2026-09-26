"use client";
import { useEffect, useRef, useState } from "react";
import { useSite } from "../site-provider.jsx";
import PartIcon from "../part-icon.jsx";
import { Check, Lock } from "../icons.jsx";
import Field from "./field.jsx";

export default function PartForm({ initial, section, busy, onSubmit, onDirtyChange }) {
  const { catalog, t } = useSite();
  const { parts, partCategories, manufacturers } = catalog;
  const [start] = useState(() =>
    initial
      ? { ...initial, price: initial.price ?? "" }
      : {
          section,
          category: partCategories[section][0],
          name: "",
          notes: "",
          price: "",
        },
  );
  const [c, set] = useState(start);
  const [search, setSearch] = useState("");
  const update = (k, v) => set((p) => ({ ...p, [k]: v }));
  const suggestions = (parts[c.category] || []).filter((p) =>
    p.toLowerCase().includes(search.toLowerCase()),
  );
  const dirty = Object.keys(c).some(
    (k) => String(c[k] ?? "") !== String(start[k] ?? ""),
  );
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  // The field where Enter is down. Enter in a field moves to the next one
  // instead of saving: the window closes by «Сохранить деталь», not by a
  // key pressed mid-input (#129); the manufacturer alone already fills the
  // name. Only the implicit submission is stopped, so Enter still picks a
  // suggestion where the browser handles it.
  const enterIn = useRef(null);
  return (
    <form
      onKeyDown={(e) => {
        enterIn.current =
          e.key === "Enter" &&
          e.target.tagName === "INPUT" &&
          !e.nativeEvent.isComposing
            ? e.target
            : null;
      }}
      onKeyUp={() => {
        enterIn.current = null;
      }}
      onSubmit={(e) => {
        e.preventDefault();
        const field = enterIn.current;
        enterIn.current = null;
        if (field) {
          const fields = [...e.currentTarget.elements].filter(
            (el) =>
              !el.disabled && (el.tagName !== "BUTTON" || el.type === "submit"),
          );
          fields[fields.indexOf(field) + 1]?.focus();
          return;
        }
        onSubmit({ ...c, price: c.price === "" ? null : Number(c.price) });
      }}
    >
      <div className="selected-part-icon">
        <PartIcon category={c.category} icons={catalog.icons} size={38} />
        <span>{c.category}</span>
      </div>
      <Field label={t("Категория")}>
        <select
          value={c.category}
          onChange={(e) => {
            update("category", e.target.value);
            setSearch("");
          }}
        >
          {Array.from(new Set([c.category, ...partCategories[section]]))
            .filter(Boolean)
            .map((p) => (
              <option key={p}>{p}</option>
            ))}
        </select>
      </Field>
      <Field label={t("Производитель")}>
        <input
          list="component-manufacturers"
          enterKeyHint="next"
          placeholder={t("Выберите производителя")}
          onChange={(e) => {
            update("name", e.target.value + " ");
            setSearch(e.target.value);
          }}
        />
        <datalist id="component-manufacturers">
          {manufacturers
            .filter(
              (m) =>
                !search ||
                m.toLowerCase().includes(search.trim().toLowerCase()),
            )
            .slice(0, 8)
            .map((m) => (
              <option key={m} value={m} />
            ))}
        </datalist>
      </Field>
      <Field label={t("Компонент или модель")}>
        <input
          required
          autoFocus
          enterKeyHint="next"
          maxLength={150}
          value={c.name}
          onChange={(e) => {
            update("name", e.target.value);
            setSearch(e.target.value);
          }}
          placeholder={t("Например, Brooks C17")}
        />
      </Field>
      {suggestions.length > 0 && (
        <div className="suggestions" aria-label={t("Модели из справочника")}>
          {suggestions.slice(0, 8).map((p) => (
            <button
              key={p}
              type="button"
              className={c.name === p ? "chosen" : ""}
              onClick={() => {
                update("name", p);
                setSearch("");
              }}
            >
              {p}
              {c.name === p && <Check size={14} />}
            </button>
          ))}
        </div>
      )}
      <p className="help">
        {t("Выберите из справочника или введите своё название.")} Показываем до
        8 совпадений — уточните название.
      </p>
      <Field label={t("Примечание")}>
        <input
          maxLength={500}
          enterKeyHint="next"
          value={c.notes}
          onChange={(e) => update("notes", e.target.value)}
          placeholder={t("Размер, материал, передаточное отношение…")}
        />
      </Field>
      <Field label="Группа">
        <select
          value={c.group_id || ""}
          onChange={(e) => update("group_id", e.target.value)}
        >
          <option value="">По категории</option>
          {catalog.componentGroups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Ссылка на компонент или аксессуар">
        <input
          type="url"
          enterKeyHint="next"
          value={c.url || ""}
          maxLength={2048}
          onChange={(e) => update("url", e.target.value)}
          placeholder="https://…"
        />
      </Field>
      <Field label={t("Стоимость покупки / апгрейда, ₽")}>
        <input
          type="number"
          min="0"
          max="999999999"
          step="0.01"
          enterKeyHint="next"
          value={c.price}
          onChange={(e) => update("price", e.target.value)}
          placeholder={t("Необязательно")}
        />
      </Field>
      <p className="help">
        <Lock size={13} />
        {t("Стоимость видна только вам.")}
      </p>
      <button className="button block" disabled={busy}>
        {busy ? t("Сохраняем…") : t("Сохранить деталь")}
        <Check size={18} />
      </button>
    </form>
  );
}
