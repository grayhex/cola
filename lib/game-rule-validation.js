import { z } from "zod";
import { gameMetrics, metricByKey } from "./game-metrics.js";
import { categories } from "./catalog.js";
import { gameDescriptionLimit } from "./gamification-presentation.js";

// The input of an award or a record (#106). Client-safe: the admin editor
// checks a rule while it is being edited, the server checks it again.
const keyword = z
  .string()
  .trim()
  // Letters, digits, spaces and hyphens only: the words go into a SQL regular
  // expression as they are.
  .regex(/^[\p{L}\p{N}][\p{L}\p{N} -]{0,29}$/u, {
    error: "Ключевое слово — буквы, цифры, пробел или дефис, до 30 знаков",
  });
export const ruleInput = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/, {
      error: "Ключ — латинские буквы, цифры и подчёркивание",
    }),
    kind: z.enum(["award", "record"]),
    metric: z.enum(gameMetrics.map((m) => m.key)),
    comparison: z.enum(["gte", "lte"]).default("gte"),
    threshold: z
      .number()
      .finite()
      .min(0, { error: "Порог не может быть отрицательным" })
      .nullable()
      .default(null),
    direction: z.enum(["max", "min"]).nullable().default(null),
    category: z.enum(Object.keys(categories)).nullable().default(null),
    minDistanceKm: z
      .number()
      .finite()
      .min(0, { error: "Дистанция не может быть отрицательной" })
      .max(10000, { error: "Минимальная дистанция — до 10 000 км" })
      .nullable()
      .default(null),
    keywords: z
      .array(keyword)
      .max(10, { error: "Не больше 10 ключевых слов" })
      .default([]),
    name: z
      .string()
      .trim()
      .min(1, { error: "Укажите название" })
      .max(60, { error: "Название — до 60 знаков" }),
    description: z
      .string()
      .trim()
      .max(gameDescriptionLimit, {
        error: "Описание — до " + gameDescriptionLimit + " знаков",
      })
      .default(""),
    imageId: z.uuid().nullable().default(null),
    enabled: z.boolean(),
  })
  .strict()
  .superRefine((rule, context) => {
    const metric = metricByKey[rule.metric];
    const issue = (message, path) =>
      context.addIssue({ code: "custom", message, path: [path] });
    if (!metric[rule.kind])
      issue(
        rule.kind === "award"
          ? "Эта метрика не подходит для награды"
          : "Эта метрика не подходит для рекорда",
        "metric",
      );
    if (rule.kind === "award") {
      if (rule.threshold == null) issue("Укажите порог награды", "threshold");
      else if (rule.threshold > metric.max)
        issue("Порог больше допустимого для метрики", "threshold");
      if (rule.direction != null)
        issue("У награды нет направления", "direction");
    } else {
      if (rule.direction == null)
        issue("Выберите максимум или минимум", "direction");
      if (rule.threshold != null) issue("У рекорда нет порога", "threshold");
    }
    if (rule.category && !metric.filters.includes("category"))
      issue("Фильтр по типу велосипеда не подходит для метрики", "category");
    if (rule.minDistanceKm != null && !metric.filters.includes("minDistanceKm"))
      issue("Минимальная дистанция — только для покатушек", "minDistanceKm");
    if (rule.keywords.length && !metric.filters.includes("keywords"))
      issue("Ключевые слова — только для метрики деталей", "keywords");
    if (rule.metric === "keywords" && !rule.keywords.length)
      issue("Укажите ключевые слова", "keywords");
  });
export const rulesInput = z
  .object({ rules: z.array(ruleInput).max(200) })
  .strict()
  .refine((v) => new Set(v.rules.map((r) => r.key)).size === v.rules.length, {
    message: "Ключи правил повторяются",
  });
