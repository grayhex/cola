"use client";
import type { Classification } from "../../lib/contracts.ts";
import type { ClassificationSource } from "../../lib/bike-classification.ts";
import {
  bikeCategories,
  bikeSubtypes,
  emptyClassification,
  suspensionLabels,
  constructionLabels,
  useLabels,
  classificationOf,
  classificationLabels,
  classificationFilterOptions,
} from "../../lib/bike-classification.ts";
import { bikeCategoryTone } from "../../lib/content-labels.ts";
import { ContentLabel } from "./content-label.tsx";
import styles from "./bike-classification.module.css";

function Choice({
  label,
  value,
  choices,
  onChange,
  required = false,
  empty = "Не указано",
  disabled = false,
  id,
}: {
  id?: string;
  label: string;
  value?: string | null;
  choices: Record<string, string>;
  onChange: (value: string) => void;
  required?: boolean;
  empty?: string;
  disabled?: boolean;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select
        id={id}
        aria-label={label}
        value={value || ""}
        required={required}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{empty}</option>
        {Object.entries(choices).map(([key, text]) => (
          <option key={key} value={key}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}
export default function ClassificationFields({
  value,
  onChange,
  disabled = false,
  categoryId,
}: {
  value: Classification;
  onChange: (value: Classification) => void;
  disabled?: boolean;
  // Lets a form that finds the category missing bring it into focus.
  categoryId?: string;
}) {
  const c = { ...emptyClassification, ...value };
  const set = <K extends keyof Classification>(key: K, v: Classification[K]) =>
    onChange({ ...c, [key]: v });
  return (
    <fieldset
      className={styles.fields}
      disabled={disabled}
      aria-label="Классификация велосипеда"
    >
      <div className={styles.grid}>
        <Choice
          id={categoryId}
          label="Категория велосипеда"
          value={c.category}
          choices={bikeCategories}
          required
          empty="Выберите категорию"
          onChange={(category) => onChange({ ...c, category, subtype: null })}
        />
        <Choice
          label="Подтип велосипеда"
          value={c.subtype}
          choices={bikeSubtypes[c.category] || {}}
          disabled={!c.category}
          onChange={(v) => set("subtype", v || null)}
        />
      </div>
      <details className={styles.details}>
        <summary>Классификация / Особенности</summary>
        <div className={styles.grid}>
          <Choice
            label="Амортизация"
            value={c.suspension}
            choices={suspensionLabels}
            onChange={(v) => set("suspension", v || null)}
          />
          <Choice
            label="Конструкция"
            value={c.construction}
            choices={constructionLabels}
            onChange={(v) => set("construction", v || null)}
          />
        </div>
        <div className={styles.toggles}>
          <label>
            <input
              type="checkbox"
              checked={c.electric}
              onChange={(e) => set("electric", e.target.checked)}
            />
            Electric · электропривод
          </label>
          <label>
            <input
              type="checkbox"
              checked={c.fatbike}
              onChange={(e) => set("fatbike", e.target.checked)}
            />
            Fatbike
          </label>
        </div>
        <fieldset className={styles.uses}>
          <legend>Назначения · {c.uses.length}/3</legend>
          {Object.entries(useLabels).map(([key, text]) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={c.uses.includes(key)}
                disabled={!c.uses.includes(key) && c.uses.length >= 3}
                onChange={(e) =>
                  set(
                    "uses",
                    e.target.checked
                      ? [...c.uses, key]
                      : c.uses.filter((v) => v !== key),
                  )
                }
              />
              {text}
            </label>
          ))}
        </fieldset>
        <p className="help">
          Поля независимы. Неизвестные особенности можно не указывать.
        </p>
      </details>
    </fieldset>
  );
}
export function ClassificationBadges({ bike }: { bike: ClassificationSource }) {
  const classification = classificationOf(bike);
  const tone = bikeCategoryTone[classification.category] || "neutral";
  const labels = classificationLabels(bike);
  const uses = classification.uses.map((key) => useLabels[key]);
  return (
    <>
      {!!labels.length && (
        <span className={styles.badges} role="group" aria-label="Классификация">
          {labels.map((text, i) => (
            <ContentLabel
              key={text}
              tone={tone}
              data-bike-label={i === 0 ? "type" : "feature"}
              title={labels.join(" · ")}
            >
              {text}
            </ContentLabel>
          ))}
        </span>
      )}
      {!!uses.length && (
        <ContentLabel
          tone={tone}
          data-bike-label="use"
          aria-label={"Назначения: " + uses.join(", ")}
        >
          {uses.join(" · ")}
        </ContentLabel>
      )}
    </>
  );
}
export function ClassificationFilters({
  value = {},
  onChange,
  withCategory = false,
}: {
  value?: Record<string, string | null>;
  onChange: (value: Record<string, string>) => void;
  withCategory?: boolean;
}) {
  const active = Object.entries(value).filter(([, v]) => !!v).length;
  return (
    <details className={styles.filters}>
      <summary>Классификация{active ? ` · ${active}` : ""}</summary>
      <div className={styles.grid}>
        {withCategory && (
          <Choice
            label="Категория велосипеда"
            value={value.category}
            choices={bikeCategories}
            empty="Все категории"
            onChange={(v) => onChange({ category: v })}
          />
        )}
        {Object.entries(classificationFilterOptions).map(([key, choices]) => (
          <Choice
            key={key}
            label={
              (
                {
                  subtype: "Подтип",
                  suspension: "Амортизация",
                  construction: "Конструкция",
                  use: "Назначение",
                  electric: "Электропривод",
                  fatbike: "Fatbike",
                } as Record<string, string>
              )[key]
            }
            value={value[key]}
            choices={choices}
            empty="Все"
            onChange={(v) => onChange({ [key]: v })}
          />
        ))}
      </div>
      {!!active && (
        <button
          type="button"
          className="quiet"
          onClick={() =>
            onChange(
              Object.fromEntries(Object.keys(value).map((key) => [key, ""])),
            )
          }
        >
          Сбросить особенности
        </button>
      )}
    </details>
  );
}
