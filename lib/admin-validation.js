import { bikeCategories } from "./bike-classification.js";
import { defaultArticleTopics } from "./article-topics.js";
import { mapDefaults } from "./map-settings.js";
import { aboutDefaults, aboutItemIds } from "./about-content.js";
import { scoringInput } from "./social-validation.js";
import { heroDefaults } from "./theme.js";
import { defaultGroups, defaultBlocks } from "./garage-layout.js";
import { z } from "zod";
import { iconNames } from "./part-icons.js";
import {
  defaultPurposes,
  defaultAliases,
  normalizeName,
} from "./experience-catalog.js";
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
const mapUrl = z
  .string()
  .max(2000)
  .refine((s) => {
    if (!s) return true;
    try {
      const u = new URL(s.replaceAll("{key}", "token"));
      return u.protocol === "https:" && !u.username && !u.password;
    } catch {
      return false;
    }
  }, "Нужен HTTPS URL без логина и пароля");
export const mapInput = z
  .object({
    enabled: z.boolean(),
    provider: z.enum(["osm", "yandex", "raster", "style"]),
    tileUrl: mapUrl,
    styleUrl: mapUrl,
    publicKey: z.string().trim().max(500),
    attribution: z.string().trim().max(200),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.enabled && v.provider === "yandex" && !v.publicKey)
      ctx.addIssue({
        code: "custom",
        message: "Укажите API-ключ JavaScript API Яндекс Карт",
        path: ["publicKey"],
      });
    if (
      v.provider === "raster" &&
      !["{z}", "{x}", "{y}"].every((t) => v.tileUrl.includes(t))
    )
      ctx.addIssue({
        code: "custom",
        message: "Шаблон тайлов должен содержать {z}, {x}, {y}",
        path: ["tileUrl"],
      });
    if (v.provider === "style" && !v.styleUrl)
      ctx.addIssue({
        code: "custom",
        message: "Укажите URL стиля",
        path: ["styleUrl"],
      });
  });
export const settingsInput = z
  .object({
    // Emoji slots were replaced by a fixed icon set (#104): saved values are
    // accepted and dropped on the next save.
    emojis: z
      .unknown()
      .optional()
      .transform(() => undefined),
    articleTopics: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z0-9_-]{1,40}$/),
            label: z.string().trim().min(1).max(60),
            emoji: z
              .unknown()
              .optional()
              .transform(() => undefined),
          })
          .strict(),
      )
      .min(1)
      .max(24)
      .refine((a) => new Set(a.map((v) => v.id)).size === a.length)
      .default(defaultArticleTopics),
    map: mapInput.default(mapDefaults),
    rideListMode: z.enum(["auto", "cards", "list"]).default("auto"),
    rideMapView: z.enum(["map", "route", "hidden"]).default("map"),
    mapScrollZoom: z.boolean().default(false),
    navigation: z
      .array(
        z
          .object({
            id: z.enum([
              "bikes",
              "journal",
              "articles",
              "rides",
              "market",
              "about",
            ]),
            label: z.string().trim().min(1).max(32),
            visible: z.boolean(),
          })
          .strict(),
      )
      .min(3)
      .max(6)
      .refine(
        (a) =>
          new Set(a.map((s) => s.id)).size === a.length &&
          ["bikes", "rides", "about"].every((id) => a.some((s) => s.id === id)),
      )
      .optional(),
    about: z
      .object({
        sections: z
          .array(
            z
              .object({
                id: z.enum(["guide", "technology", "history"]),
                title: name,
                visible: z.boolean(),
                showIllustration: z.boolean(),
              })
              .strict(),
          )
          .min(2)
          .max(3)
          .refine(
            (a) =>
              new Set(a.map((s) => s.id)).size === a.length &&
              ["guide", "technology"].every((id) => a.some((s) => s.id === id)),
          ),
        hiddenItems: z
          .array(z.enum([...aboutItemIds, "milestones", "metrics", "process"]))
          .max(aboutItemIds.length + 3)
          .refine((a) => new Set(a).size === a.length),
      })
      .strict()
      .default(aboutDefaults),
    aboutGuideImageId: asset.default(null),
    aboutTechnologyImageId: asset.default(null),
    scoring: scoringInput,
    showMileage: z.boolean().default(false),
    componentsExpanded: z.boolean().default(false),
    appVersionLabel: z.string().trim().max(40).default(""),
    parserVersionLabel: z.string().trim().max(40).default(""),
    // Unused since the bike page follows the #104 mockup; saved values and
    // the block list below stay valid so old settings still save.
    bikeLayout: z.enum(["dense", "balanced", "spacious"]).default("balanced"),
    mtbImageId: asset.default(null),
    roadImageId: asset.default(null),
    gravelImageId: asset.default(null),
    appearance: z
      .object({
        theme: z.enum(["system", "light", "dark"]),
        accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      })
      .strict()
      .default({ theme: "system", accent: "#C2410C" }),
    backgroundLightId: asset.default(null),
    backgroundDarkId: asset.default(null),
    backgroundLightOpacity: z.number().int().min(0).max(100).default(20),
    backgroundDarkOpacity: z.number().int().min(0).max(100).default(20),
    backgroundLightMode: z.enum(["cover", "tile"]).default("cover"),
    backgroundDarkMode: z.enum(["cover", "tile"]).default("cover"),
    heroImageId: asset.default(null),
    heroAnimationLightId: asset.default(null),
    heroAnimationDarkId: asset.default(null),
    heroBackgroundLight: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .default("#FFFCF2"),
    heroBackgroundDark: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .default("#24221B"),
    heroHeadline: z
      .string()
      .trim()
      .min(1)
      .max(150)
      .default(heroDefaults.heroHeadline),
    heroDescription: z
      .string()
      .trim()
      .max(300)
      .default(heroDefaults.heroDescription),
    showAboutStats: z.boolean().default(true),
    summaryPosition: z.enum(["left", "right", "below"]),
    detailOrder: z.enum(["photo-first", "specs-first"]),
    photoMode: z.enum(["natural", "cover"]),
    photoRatio: z.enum(["4/3", "3/2", "16/9", "1/1"]),
    textAlign: z.enum(["left", "center"]),
    desktopColumns: z.number().int().min(2).max(5),
    showTagline: z.boolean(),
    showDemo: z.boolean(),
    registrationOpen: z.boolean(),
    siteName: name,
    showcaseTitle: name.default("Наши велосипеды"),
    siteDescription: z.string().trim().max(300),
    faviconId: asset,
    demoImageId: asset,
    wizardLinkLabel: name.default("Распознать по странице магазина"),
    wizardManualLabel: name.default("Заполнить вручную"),
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
          .refine(
            (s) => !["__proto__", "constructor", "prototype"].includes(s),
          ),
        z.string().max(2000),
      )
      .refine((v) => Object.keys(v).length <= 500, "Слишком много текстов"),
  })
  .strict();
export const catalogInput = z
  .object({
    purposes: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z][a-z0-9_-]{0,29}$/),
            name,
            enabled: z.boolean(),
          })
          .strict(),
      )
      .max(12)
      .refine((a) => new Set(a.map((x) => x.id)).size === a.length)
      .default(defaultPurposes),
    aliases: z
      .array(
        z
          .object({
            kind: z.enum(["brand", "model", "component"]),
            alias: name,
            name,
            scope: z.string().trim().max(150).default(""),
          })
          .strict(),
      )
      .max(500)
      .refine(
        (a) =>
          a.every(
            (r) =>
              normalizeName(r.alias) &&
              normalizeName(r.name) &&
              normalizeName(r.alias) !== normalizeName(r.name),
          ),
        "Вариант и основное название должны отличаться",
      )
      .refine(
        (a) =>
          new Set(
            a.map((r) =>
              [r.kind, normalizeName(r.scope), normalizeName(r.alias)].join(
                ":",
              ),
            ),
          ).size === a.length,
        "Вариант уже существует",
      )
      .refine(
        (a) =>
          !a.some((r) =>
            a.some(
              (s) =>
                s.kind === r.kind &&
                (!s.scope ||
                  !r.scope ||
                  normalizeName(s.scope) === normalizeName(r.scope)) &&
                normalizeName(r.name).includes(normalizeName(s.alias)),
            ),
          ),
        "Цепочки и циклы вариантов не допускаются",
      )
      .refine(
        (a) =>
          !a.some((r, i) =>
            a.some(
              (s, j) =>
                i !== j &&
                r.kind === s.kind &&
                normalizeName(r.alias) === normalizeName(s.alias) &&
                (!r.scope ||
                  !s.scope ||
                  normalizeName(r.scope) === normalizeName(s.scope)),
            ),
          ),
        "Области одинаковых вариантов не должны пересекаться",
      )
      .default(defaultAliases),
    categories: z.object({
      gravel: name,
      road: name,
      ...Object.fromEntries(
        Object.entries(bikeCategories).map(([key, label]) => [
          key,
          name.default(label),
        ]),
      ),
    }),
    models: z.object({
      gravel: z.record(safeKey, strings),
      mtb: z.record(safeKey, strings),
      road: z.record(safeKey, strings),
      ...Object.fromEntries(
        Object.keys(bikeCategories)
          .filter((key) => key !== "mtb")
          .map((key) => [key, z.record(safeKey, strings).default({})]),
      ),
    }),
    parts: z.record(safeKey, strings),
    partCategories: z.object({
      build: strings.min(1),
      accessories: strings.min(1),
    }),
    sizes: strings.max(40).default(["XS", "S", "M", "L", "XL"]),
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
/** @typedef {z.infer<typeof userInput>} ManagedUserInput */
export const userInput = z.object({
  name: z.string().trim().min(1).max(60),
  email: z
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  role: z.enum(["user", "admin"]),
  blocked: z.boolean(),
});
