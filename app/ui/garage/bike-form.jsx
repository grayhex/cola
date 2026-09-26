"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import { useSite } from "../site-provider.jsx";
import ClassificationFields from "../bike-classification.jsx";
import { FormerBikeField } from "../bike-fields.jsx";
import fieldStyles from "../bike-fields.module.css";
import { classificationOf, compatibilityCategory } from "../../../lib/bike-classification.js";
import { parseBikeName } from "../../../lib/bike-name.js";
import { Check } from "../icons.jsx";
import Field from "./field.jsx";

const FactorySpecification = dynamic(
  () => import("../factory-specification.jsx"),
  { ssr: false },
);

const blankBike = {
  name: "",
  brand: "",
  model: "",
  year: new Date().getFullYear(),
  category: "gravel",
  description: "",
  color: "",
  size: "",
  weight: "",
  is_former: false,
};

export default function BikeForm({ initial, busy, onSubmit }) {
  const { catalog, t } = useSite();
  const { models } = catalog;
  const [b, set] = useState(
    initial
      ? { ...initial, price: initial.price ?? "", weight: initial.weight || "" }
      : {
          ...blankBike,
          price: "",
          manufacturer_url: "",
          show_bike_price: false,
          show_component_prices: false,
          show_accessory_prices: false,
        },
  );
  const [resolving, setResolving] = useState(false);
  const update = (k, v) =>
    set((p) => ({
      ...p,
      [k]: v,
      ...(["brand", "model", "trim", "year"].includes(k)
        ? {
            importFactory: false,
            factoryCandidateId: undefined,
            factory_spec: null,
          }
        : {}),
    }));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          ...b,
          year: Number(b.year),
          price: b.price === "" ? null : Number(b.price),
          weight: b.weight === "" ? null : Number(b.weight),
        });
      }}
    >
      <Field label={t("Название вашего велосипеда")}>
        <input
          autoFocus
          required
          maxLength={100}
          value={b.name}
          onChange={(e) => update("name", e.target.value)}
          onBlur={() => {
            if (!initial && !b.brand && !b.model) {
              const parsed = parseBikeName(b.name, [
                ...new Set(Object.values(models).flatMap(Object.keys)),
              ]);
              if (parsed)
                set((p) => ({
                  ...p,
                  ...parsed,
                  importFactory: false,
                  factory_spec: null,
                }));
            }
          }}
          className={fieldStyles.modelInput}
        />
      </Field>
      <FormerBikeField
        value={b.is_former}
        disabled={busy}
        onChange={(value) => update("is_former", value)}
      />
      <ClassificationFields
        value={classificationOf(b)}
        onChange={(classification) =>
          set((previous) => ({
            ...previous,
            classification,
            category: compatibilityCategory(classification),
          }))
        }
      />
      <div className="form-grid">
        <Field label={t("Год")}>
          <input
            type="number"
            min="1900"
            max="2100"
            required
            value={b.year}
            onChange={(e) => update("year", e.target.value)}
          />
        </Field>
        <Field label={t("Марка")}>
          <input
            list="brands"
            maxLength={60}
            value={b.brand}
            onChange={(e) => update("brand", e.target.value)}
            placeholder={t("Выберите или введите")}
          />
          <datalist id="brands">
            {Object.keys(models[b.category] || {}).map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </Field>
        <Field label={t("Модель")}>
          <input
            list="models"
            maxLength={100}
            value={b.model}
            onChange={(e) => update("model", e.target.value)}
            placeholder={t("Выберите или введите")}
          />
          <datalist id="models">
            {(models[b.category]?.[b.brand] || []).map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </Field>
        <Field label={t("Размер рамы")}>
          <input
            maxLength={30}
            value={b.size}
            onChange={(e) => update("size", e.target.value)}
            placeholder={t("M / 54 см")}
          />
        </Field>
        <Field label={t("Вес, кг")}>
          <input
            type="number"
            min="0.01"
            max="100"
            step="0.01"
            value={b.weight}
            onChange={(e) => update("weight", e.target.value)}
            placeholder="10.8"
          />
        </Field>
      </div>
      <Field label={t("Комплектация модели")}>
        <input
          maxLength={100}
          value={b.trim || ""}
          onChange={(e) => update("trim", e.target.value)}
          placeholder="SL / CF SLX 8 AXS"
        />
      </Field>
      <fieldset className="bike-purposes">
        <legend>Метки опыта — необязательно</legend>
        {catalog.purposes
          .filter((p) => p.enabled || (b.purposes || []).includes(p.id))
          .map((p) => (
            <label key={p.id}>
              <input
                type="checkbox"
                checked={(b.purposes || []).includes(p.id)}
                onChange={(e) =>
                  update(
                    "purposes",
                    e.target.checked
                      ? [...(b.purposes || []), p.id]
                      : (b.purposes || []).filter((id) => id !== p.id),
                  )
                }
              />
              {p.name}
            </label>
          ))}
      </fieldset>
      <FactorySpecification
        key={JSON.stringify([b.brand, b.model, b.trim, b.year])}
        bike={b}
        automatic={!initial}
        onBusy={setResolving}
        onReset={() =>
          set((p) => ({ ...p, importFactory: false, initializeCurrent: false }))
        }
        onImport={(candidateId, initializeCurrent, sourceUrl) =>
          set((p) => ({
            ...p,
            importFactory: true,
            factoryCandidateId: candidateId,
            factorySourceUrl: sourceUrl,
            initializeCurrent,
          }))
        }
        imported={b.importFactory}
      />
      <Field label={t("Сайт производителя")}>
        <input
          type="url"
          value={b.manufacturer_url || ""}
          onChange={(e) => update("manufacturer_url", e.target.value)}
          placeholder="https://…"
        />
      </Field>
      <Field label={t("Стоимость велосипеда")}>
        <input
          type="number"
          min="0"
          max="999999999"
          step="0.01"
          value={b.price ?? ""}
          onChange={(e) => update("price", e.target.value)}
        />
      </Field>
      <details className="price-settings">
        <summary>{t("Отображение стоимости")}</summary>
        <p className="help">
          Включённая стоимость видна в карточке и по публичной ссылке, если
          доступ открыт.
        </p>
        {[
          ["show_bike_price", "Велосипед"],
          ["show_component_prices", "Компоненты"],
          ["show_accessory_prices", "Аксессуары"],
        ].map(([key, label]) => (
          <label className="setting-row" key={key}>
            {label}
            <input
              type="checkbox"
              checked={!!b[key]}
              onChange={(e) => update(key, e.target.checked)}
            />
          </label>
        ))}
      </details>
      <Field label="Текущий пробег, км">
        <input
          type="number"
          min="0"
          max="10000000"
          step="1"
          value={b.mileage ?? 0}
          onChange={(e) => update("mileage", Number(e.target.value))}
        />
      </Field>
      <Field label={t("Цвет")}>
        <input
          maxLength={60}
          value={b.color}
          onChange={(e) => update("color", e.target.value)}
          placeholder={t("Название или оттенок")}
        />
      </Field>
      <Field label={t("Пара слов о велосипеде")}>
        <textarea
          rows={3}
          maxLength={2000}
          value={b.description}
          onChange={(e) => update("description", e.target.value)}
          placeholder={t("Для каких дорог и приключений он создан?")}
        />
      </Field>
      <p className="help">
        {t(
          "Фотографии можно добавить после сохранения. Велосипед по умолчанию приватный.",
        )}
      </p>
      <button className="button block" disabled={busy || resolving}>
        {busy ? t("Сохраняем…") : t("Сохранить велосипед")}
        <Check size={18} />
      </button>
    </form>
  );
}
