import { z } from "zod";
import {
  bikeCategories,
  bikeSubtypes,
  subtypeLabels,
  suspensionLabels,
  constructionLabels,
  useLabels,
  classificationFilterOptions,
} from "./bike-classification.js";
const optionalChoice = (labels) =>
  z.enum(Object.keys(labels)).nullable().default(null);
export const classificationInput = z
  .object({
    category: z.enum(Object.keys(bikeCategories)),
    subtype: optionalChoice(subtypeLabels),
    suspension: optionalChoice(suspensionLabels),
    construction: optionalChoice(constructionLabels),
    uses: z
      .array(z.enum(Object.keys(useLabels)))
      .max(3)
      .refine(
        (v) => new Set(v).size === v.length,
        "Назначения не должны повторяться",
      )
      .default([]),
    electric: z.boolean().default(false),
    fatbike: z.boolean().default(false),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.subtype && !Object.hasOwn(bikeSubtypes[v.category], v.subtype))
      ctx.addIssue({
        code: "custom",
        path: ["subtype"],
        message: "Подтип не относится к выбранной категории",
      });
  });
export const classificationQueryShape = Object.fromEntries(
  Object.entries(classificationFilterOptions).map(([key, values]) => [
    key,
    z.enum(["", ...Object.keys(values)]).default(""),
  ]),
);
export const classificationQueryInput = z.object(classificationQueryShape);
