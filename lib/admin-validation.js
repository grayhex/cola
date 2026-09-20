import { mapDefaults } from "./map-settings.js";
import { aboutDefaults, aboutItemIds } from "./about-content.js";
import { scoringInput } from "./social-validation.js";
import { defaultGroups, defaultBlocks } from "./garage-layout.js";
import { z } from "zod";
import { fontNames } from "./fonts.js";
import { uiIconNames } from "./ui-icons.js";
import { iconPaths } from "./part-icons.js";
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
    provider: z.enum(["osm", "raster", "style"]),
    tileUrl: mapUrl,
    styleUrl: mapUrl,
    publicKey: z.string().max(500),
    attribution: z.string().trim().max(200),
  })
  .strict()
  .superRefine((v, ctx) => {
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
export const settingsInput = z.object({
  map: mapInput.default(mapDefaults),
  navigation: z
    .array(
      z
        .object({
          id: z.enum(["bikes", "journal", "rides", "about"]),
          label: z.string().trim().min(1).max(32),
          visible: z.boolean(),
        })
        .strict(),
    )
    .min(3)
    .max(4)
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
  navRidesIconId: asset.default(null),
  navJournalIconId: asset.default(null),
  navAboutIconId: asset.default(null),
  aboutGuideImageId: asset.default(null),
  aboutTechnologyImageId: asset.default(null),
  aboutHistoryImageId: asset.default(null),
  scoring: scoringInput,
  showMileage: z.boolean().default(false),
  bikeLayout: z.enum(["dense", "balanced", "spacious"]).default("balanced"),
  mtbImageId: asset.default(null),
  roadImageId: asset.default(null),
  gravelImageId: asset.default(null),
  theme: z.enum(["light", "dark", "system"]),
  font: z.enum(fontNames),
  uiIcons: z.partialRecord(z.enum(uiIconNames), asset).default({}),
  partIconAssets: z
    .partialRecord(z.enum(Object.keys(iconPaths)), asset)
    .default({}),
  navNewIconId: asset.default(null),
  navPopularIconId: asset.default(null),
  loginImageId: asset.default(null),
  registerImageId: asset.default(null),
  showAboutStats: z.boolean().default(true),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  radius: z.number().int().min(0).max(28),
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
  showcaseTitle: name.default("Витрина"),
  siteDescription: z.string().trim().max(300),
  logoId: asset,
  faviconId: asset,
  demoImageId: asset,
  garageImageId: asset,
  backgroundImageId: asset.default(null),
  backgroundOpacity: z.number().int().min(0).max(100).default(20),
  backgroundMode: z.enum(["cover", "tile"]).default("cover"),
  navIconSize: z.enum(["small", "medium", "large"]).default("medium"),
  navOrder: z
    .array(
      z.enum([
        "home",
        "profile",
        "subscriptions",
        "records",
        "messages",
        "search",
        "admin",
        "logout",
      ]),
    )
    .length(8)
    .refine((v) => new Set(v).size === 8)
    .default([
      "home",
      "profile",
      "subscriptions",
      "records",
      "messages",
      "search",
      "admin",
      "logout",
    ]),
  wizardLinkIconId: asset.default(null),
  wizardManualIconId: asset.default(null),
  wizardLinkLabel: name.default("Распознать по странице магазина"),
  wizardManualLabel: name.default("Заполнить вручную"),
  navHomeIconId: asset.default(null),
  navProfileIconId: asset.default(null),
  navMessagesIconId: asset.default(null),
  navSubscriptionsIconId: asset.default(null),
  navRecordsIconId: asset.default(null),
  navAdminIconId: asset.default(null),
  navLogoutIconId: asset.default(null),
  addBikeIconId: asset.default(null),
  searchIconId: asset.default(null),
  likeIconId: asset.default(null),
  mtbTypeIconId: asset.default(null),
  roadTypeIconId: asset.default(null),
  gravelTypeIconId: asset.default(null),
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
      .default(defaultAliases),
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
export const userInput = z.object({
  name: z.string().trim().min(1).max(60),
  email: z
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  role: z.enum(["user", "admin"]),
  blocked: z.boolean(),
});
