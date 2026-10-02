import type { BikeDto } from "./contracts.ts";
import {
  classificationLabels,
  classificationOf,
  useLabels,
} from "./bike-classification.ts";

// The passport of a bike (#291): general facts only, each from a field the
// owner filled in. Nothing is guessed from the model name, no part of the
// build is repeated, and an empty fact is not a row.
export type PassportKey =
  | "type"
  | "use"
  | "model"
  | "year"
  | "size"
  | "color"
  | "weight"
  | "status"
  | "mileage"
  | "price";
export interface PassportRow {
  key: PassportKey;
  label: string;
  value: string;
}
export interface PassportOptions {
  showMileage?: boolean;
  summaryFields?: {
    description?: boolean;
    manufacturer?: boolean;
    metadata?: boolean;
    price?: boolean;
  };
}

/** `rub` formats a price; the page passes its own formatter. */
export function passportRows(
  bike: BikeDto,
  { showMileage, summaryFields }: PassportOptions,
  rub: (value: string | number) => string,
): PassportRow[] {
  const modelName = [bike.brand, bike.model, bike.trim]
    .filter(Boolean)
    .join(" ");
  const pricePublic =
    bike.show_bike_price &&
    bike.price != null &&
    summaryFields?.price !== false;
  const rows: [PassportKey, string, string | number | null | undefined][] = [
    ["type", "Тип", classificationLabels(bike).join(" · ")],
    [
      "use",
      "Назначение",
      classificationOf(bike)
        .uses.map((key) => useLabels[key])
        .filter(Boolean)
        .join(", "),
    ],
    ["model", "Бренд / модель", modelName],
    ["year", "Модельный год", bike.year],
    ["size", "Размер рамы", bike.size],
    ["color", "Цвет", bike.color],
    [
      "weight",
      "Вес",
      bike.weight != null && Number(bike.weight) > 0
        ? Number(bike.weight).toLocaleString("ru-RU") + " кг"
        : null,
    ],
    ["status", "Статус", bike.is_former ? "Бывший" : "Текущий"],
    [
      "mileage",
      "Пробег",
      showMileage && bike.mileage != null
        ? Number(bike.mileage).toLocaleString("ru-RU") + " км"
        : null,
    ],
    ["price", "Стоимость велосипеда", pricePublic ? rub(bike.price!) : null],
  ];
  return rows
    .filter(
      ([key, , value]) =>
        value !== null &&
        value !== undefined &&
        value !== "" &&
        // `metadata: false` hides the general facts; a price the owner made
        // public and the settings allow stays.
        (summaryFields?.metadata !== false || key === "price"),
    )
    .map(([key, label, value]) => ({ key, label, value: String(value) }));
}

export interface OverviewPanels {
  about: boolean;
  passport: boolean;
  rows: PassportRow[];
  manufacturerUrl: string | null;
}

/**
 * Which of the two panels under the first screen the page draws (#291): the
 * description unless `summaryFields.description` is off, the passport when it
 * has a row or a manufacturer link the settings allow. The section menu uses
 * the same answer, so it never points at a panel that is not there.
 */
export function overviewPanels(
  bike: BikeDto,
  options: PassportOptions,
  rub: (value: string | number) => string,
): OverviewPanels {
  const rows = passportRows(bike, options, rub);
  const manufacturerUrl =
    options.summaryFields?.manufacturer !== false && bike.manufacturer_url
      ? bike.manufacturer_url
      : null;
  return {
    about: options.summaryFields?.description !== false,
    passport: rows.length > 0 || manufacturerUrl !== null,
    rows,
    manufacturerUrl,
  };
}
