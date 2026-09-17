import { defaultGroups, defaultBlocks } from "./garage-layout.js";
import { z } from "zod";
import { iconNames } from "./part-icons.js";
const name = z.string().trim().min(1).max(150);
const asset = z.uuid().nullable();
const strings = z
  .array(name)
  .max(2000)
  .refine(
    (a) => new Set(a).size === a.length,
    "Названия не должны повторяться",
  );
const safeKey = z
  .string()
  .trim()
  .min(1)
  .max(150)
  .refine(
    (s) => !["__proto__", "constructor", "prototype"].includes(s),
    "Недопустимое название",
  );
export const settingsInput = z.object({
  theme: z.enum(["light", "dark", "system"]),
  font: z.enum(["manrope", "system", "arial", "georgia", "mono"]),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  radius: z.number().int().min(0).max(28),
  summaryPosition: z.enum(["left", "right", "below"]),
  detailOrder: z.enum(["photo-first", "specs-first"]),
  photoMode: z.enum(["natural", "cover"]),
  photoRatio: z.enum(["4/3", "3/2", "16/9", "1/1"]),
  textAlign: z.enum(["left", "center"]),
  desktopColumns: z.number().int().min(2).max(4),
  showTagline: z.boolean(),
  showDemo: z.boolean(),
  registrationOpen: z.boolean(),
  siteName: name,
  siteDescription: z.string().trim().max(300),
  logoId: asset,
  faviconId: asset,
  demoImageId: asset,
  garageImageId: asset,
  detailBlocks: z
    .array(
      z.object({
        id: z.enum([
          "heading",
          "photos",
          "summary",
          "gallery",
          "specifications",
        ]),
        name,
        enabled: z.boolean(),
        variant: z.enum(["compact", "card", "plain"]),
        open: z.boolean(),
      }),
    )
    .length(5)
    .refine((a) => new Set(a.map((b) => b.id)).size === 5)
    .default(defaultBlocks),
  summaryFields: z
    .object({
      description: z.boolean(),
      metadata: z.boolean(),
      manufacturer: z.boolean(),
      price: z.boolean(),
    })
    .default({
      description: true,
      metadata: true,
      manufacturer: true,
      price: true,
    }),
  copy: z
    .record(
      z
        .string()
        .min(1)
        .max(500)
        .refine((s) => !["__proto__", "constructor", "prototype"].includes(s)),
      z.string().max(2000),
    )
    .refine((v) => Object.keys(v).length <= 500, "Слишком много текстов"),
});
export const catalogInput = z
  .object({
    categories: z.object({ gravel: name, mtb: name, road: name }),
    models: z.object({
      gravel: z.record(safeKey, strings),
      mtb: z.record(safeKey, strings),
      road: z.record(safeKey, strings),
    }),
    parts: z.record(safeKey, strings),
    partCategories: z.object({
      build: strings.min(1),
      accessories: strings.min(1),
    }),
    manufacturers: strings,
    icons: z.record(safeKey, z.enum(iconNames)),
    componentGroups: z
      .array(
        z.object({
          id: z
            .string()
            .regex(/^[a-z0-9_-]{1,50}$/)
            .refine((v) => v !== "other"),
          name,
          icon: z.enum(iconNames),
          categories: strings,
        }),
      )
      .max(30)
      .refine(
        (a) => new Set(a.map((g) => g.id)).size === a.length,
        "Группы должны иметь уникальные ID",
      )
      .refine((a) => {
        const c = a.flatMap((g) => g.categories);
        return new Set(c).size === c.length;
      }, "Категория может быть только в одной группе")
      .default(defaultGroups),
  })
  .refine(
    (c) =>
      Object.keys(c.models.gravel).length +
        Object.keys(c.models.mtb).length +
        Object.keys(c.models.road).length <=
      500,
    "Слишком много марок",
  );
export const userInput = z.object({
  name: z.string().trim().min(1).max(60),
  email: z
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  role: z.enum(["user", "admin"]),
  blocked: z.boolean(),
});
