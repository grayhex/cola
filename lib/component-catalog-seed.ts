import { z } from "zod";
import { productCategories, productCategory } from "./component-products.ts";
import { componentPhotoSource } from "./component-photo-search.ts";
import {
  absentComponent,
  componentBrands,
  componentIdentity,
  componentText,
} from "../services/bike-resolver/src/component-identity.ts";

// An offline editorial package. Importing this module never reads files or a DB.
const clean = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine(
      (s) =>
        s.trim() === s &&
        ![...s].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) &&
        !/<\/?[a-z][^>]*>|&#?\w+;/i.test(s),
      "Unclean text",
    );
const identityText = (max: number) =>
  clean(max)
    .refine((s) => componentText(s) === s, "Unclean identity")
    .refine(
      (s) => !absentComponent(s) && !/^(unknown|undefined|null)$/i.test(s),
      "Placeholder identity",
    );
const key = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,99}$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const https = z.url().refine((s) => {
  const u = new URL(s);
  return u.protocol === "https:" && !u.username && !u.password && !u.port;
}, "Expected a public HTTPS reference without credentials");
const checkedAt = z.iso.datetime();
export const seedMechanicalCategories = [
  "Вилка",
  "Амортизатор",
  "Групсет",
  "Задний переключатель",
  "Передний переключатель",
  "Манетки / дуалы",
  "Система / шатуны",
  "Педали",
  "Измеритель мощности",
  "Тормоза",
  "Колёса",
  "Обода",
  "Втулки",
  "Покрышки",
  "Руль",
  "Вынос",
  "Грипсы / обмотка",
  "Седло",
  "Подседельный штырь",
  "Дроппер",
];
export const seedAccessoryCategories = [
  "Передний свет",
  "Задний свет",
  "Крылья",
  "Багажник",
  "Подножка",
  "Звонок",
  "Велокомпьютер",
  "Датчики",
  "Замок",
  "Насос",
  "Инструменты",
  "Фляга / держатель",
  "Подседельная сумка",
  "Рамная сумка",
  "Сумка на руль",
  "Сумка на багажник",
];
const fact = z.object({ name: clean(200), value: clean(1000) }).strict();
const source = z
  .object({
    id: key,
    url: https,
    role: z.enum(["manufacturer", "technical_archive", "retailer", "commons"]),
    checkedAt,
    sha256,
    facts: z.array(fact).min(1).max(80),
  })
  .strict();
const attempt = z
  .object({
    url: https,
    checkedAt,
    imageUrl: https.nullable(),
    result: clean(500),
  })
  .strict();
export const seedPhoto = z.discriminatedUnion("status", [
  z
    .object({ status: z.literal("not_requested"), reason: clean(1000) })
    .strict(),
  z
    .object({
      status: z.literal("ready"),
      attempts: z.array(attempt).min(1).max(10),
      source: componentPhotoSource,
      file: z.string().regex(/^media\/[a-z0-9][a-z0-9-]*\.webp$/),
      sha256,
      originalSha256: sha256,
      bytes: z.number().int().positive().max(8_000_000),
      width: z.number().int().min(400).max(2400),
      height: z.number().int().min(400).max(2400),
      reviewedAt: checkedAt,
      identityReview: clean(1000),
    })
    .strict(),
  z
    .object({
      status: z.enum(["needs_permission", "not_found", "needs_review"]),
      attempts: z.array(attempt).min(1).max(10),
      reason: clean(1000),
    })
    .strict(),
]);

export const catalogSeedEntry = z
  .object({
    seedKey: key,
    status: z.enum(["approved", "needs_review", "rejected"]),
    category: identityText(60),
    brand: identityText(60),
    family: identityText(100).nullable(),
    model: identityText(100),
    name: identityText(150),
    codes: z.array(identityText(100)).max(30),
    aliases: z.array(identityText(150)).max(30),
    generation: clean(100).nullable(),
    attributes: z.record(
      z.string().min(1).max(100),
      z.union([clean(500), z.number().finite(), z.boolean()]),
    ),
    description: clean(2000).nullable(),
    descriptionGap: clean(500).nullable(),
    sources: z.array(source).min(1).max(10),
    identity: z
      .object({
        verified: z.boolean(),
        sourceIds: z.array(key).min(1).max(10),
        note: clean(1000),
        primarySourceGap: clean(1000).optional(),
      })
      .strict(),
    inclusion: clean(1000),
    photo: seedPhoto,
  })
  .strict();

export const catalogSeedScope = z
  .object({
    schemaVersion: z.literal(1),
    domain: z.enum(["mechanical", "accessories"]).optional(),
    batch: key,
    categories: z.array(
      z
        .object({
          category: identityText(60),
          included: z.boolean(),
          target: z
            .tuple([
              z.number().int().nonnegative(),
              z.number().int().positive(),
            ])
            .optional(),
          reason: clean(1000),
        })
        .strict(),
    ),
    specOnly: z.array(identityText(60)),
    selection: clean(2000),
  })
  .strict();
export const catalogSeedBatch = z
  .object({
    schemaVersion: z.literal(1),
    batch: key,
    reviewedAt: checkedAt,
    limits: z
      .object({
        models: z.number().int().positive().max(600),
        photos: z.number().int().nonnegative().max(240),
        bytes: z.number().int().nonnegative().max(128_000_000),
      })
      .strict(),
    entries: z.array(catalogSeedEntry).min(1).max(600),
  })
  .strict();
export type CatalogSeedEntry = z.infer<typeof catalogSeedEntry>;
export type CatalogSeedBatch = z.infer<typeof catalogSeedBatch>;
export type CatalogSeedScope = z.infer<typeof catalogSeedScope>;

/** SQL remains authoritative for DB aliases; here names are already componentText-clean. */
export function validateCatalogSeed(input: unknown, scopeInput: unknown) {
  const batch = catalogSeedBatch.parse(input);
  const scope = catalogSeedScope.parse(scopeInput);
  const fail = (message: string): never => {
    throw new Error(message);
  };
  if (scope.batch !== batch.batch) fail("Scope and batch disagree");
  const accessories = scope.domain === "accessories";
  // The already published mechanical v1 manifest/hash remains immutable when
  // the product taxonomy grows. New accessory manifests classify today's list.
  const taxonomy = accessories
    ? productCategories
    : productCategories.filter((category) => category !== "Сумка на багажник");
  const admitted = accessories
    ? seedAccessoryCategories
    : seedMechanicalCategories;
  const categories = new Map(scope.categories.map((c) => [c.category, c]));
  if (
    categories.size !== scope.categories.length ||
    categories.size !== taxonomy.length ||
    taxonomy.some((c) => !categories.has(c))
  )
    fail("Scope must classify every product category exactly once");
  for (const c of categories.values()) {
    if (c.included !== admitted.includes(c.category))
      fail(
        `Category is outside the ${accessories ? "accessories" : "mechanical v1"} boundary: ${c.category}`,
      );
    if (c.included && (!c.target || c.target[0] > c.target[1]))
      fail(`Missing or invalid target: ${c.category}`);
  }
  const keys = new Set<string>();
  const names = new Map<string, string>();
  const media = new Set<string>();
  const mediaHashes = new Set<string>();
  const descriptions = new Set<string>();
  let photos = 0,
    bytes = 0,
    approved = 0;
  for (const entry of batch.entries) {
    const at = entry.seedKey;
    if (!componentBrands.includes(entry.brand))
      fail(`${at}: manufacturer is not in the shared vocabulary`);
    if (keys.has(at)) fail(`Repeated seedKey: ${at}`);
    keys.add(at);
    if (
      !categories.get(entry.category)?.included ||
      productCategory(entry.category) !== entry.category
    )
      fail(`${at}: spec-only or out-of-scope category`);
    // Common manufacturer codes make a mislabeled cassette/lever/upgrade kit
    // detectable too; changing its category is not admission to this package.
    if (
      [entry.model, ...entry.codes].some((code) =>
        /^(?:CN-|CS-|BB-|BL-|SM-(?:BB|RT)|RT-(?:CL|MT)|PG-|XG-|PC-|(?:FS|RS|DB)-UPK-|DB-ACC-)/i.test(
          code,
        ),
      )
    )
      fail(`${at}: spec-only manufacturer code`);
    const identity = componentIdentity({
      brand: entry.brand,
      family: entry.family,
      model: entry.model,
      description: entry.name,
    });
    if (
      !identity ||
      identity.name !== entry.name ||
      identity.model !== entry.model ||
      identity.brand !== entry.brand ||
      (identity.family || null) !== entry.family
    )
      fail(`${at}: shared componentIdentity disagrees`);
    const sourceIds = new Set(entry.sources.map((s) => s.id));
    if (
      sourceIds.size !== entry.sources.length ||
      entry.identity.sourceIds.some((s) => !sourceIds.has(s))
    )
      fail(`${at}: missing or duplicate evidence`);
    if (!entry.description && !entry.descriptionGap)
      fail(`${at}: missing description needs a reason`);
    if (entry.description && entry.descriptionGap)
      fail(`${at}: described entry also has a gap`);
    if (entry.status !== "approved") continue;
    approved++;
    if (!entry.identity.verified)
      fail(`${at}: unverified identity cannot be approved`);
    const identitySources = entry.sources.filter((s) =>
      entry.identity.sourceIds.includes(s.id),
    );
    const primary = identitySources.some((s) =>
      ["manufacturer", "technical_archive"].includes(s.role),
    );
    // Editorially reviewed independent retailers are an explicit accessory-only
    // fallback. Subdomains are not independent evidence. This conservative
    // grouping also rejects pairs under shared suffixes such as co.uk.
    const retailers = new Set(
      identitySources
        .filter((s) => s.role === "retailer")
        .map((s) =>
          new URL(s.url).hostname.toLowerCase().split(".").slice(-2).join("."),
        ),
    );
    if (
      !primary &&
      !(accessories && entry.identity.primarySourceGap && retailers.size >= 2)
    )
      fail(
        `${at}: approved identity needs a primary source or documented independent accessory evidence`,
      );
    for (const code of entry.codes)
      if (
        !entry.sources.some((s) =>
          s.facts.some((f) => f.value.toLowerCase() === code.toLowerCase()),
        )
      )
        fail(`${at}: model code has no matching source fact: ${code}`);
    if (entry.description) {
      if (!/[А-Яа-яЁё]/.test(entry.description))
        fail(`${at}: description must be Russian`);
      if (descriptions.has(entry.description))
        fail(`${at}: duplicate description`);
      descriptions.add(entry.description);
    }
    for (const name of [entry.name, ...entry.aliases]) {
      // Full-name comparison only; no slugs, fuzzy matching or deleted suffixes.
      const exact = entry.category + "\0" + name.toLowerCase();
      const previous = names.get(exact);
      if (previous)
        fail(`${at}: duplicate name/alias with ${previous}: ${name}`);
      names.set(exact, at);
    }
    if (entry.photo.status === "ready") {
      if (media.has(entry.photo.file))
        fail(`${at}: photo reused for another model`);
      if (mediaHashes.has(entry.photo.sha256))
        fail(`${at}: photo bytes reused for another model`);
      media.add(entry.photo.file);
      mediaHashes.add(entry.photo.sha256);
      if (
        !/^(?:CC0(?: 1\.0)?|CC BY(?:-SA)?(?: [0-9.]+)?|Public domain)$/i.test(
          entry.photo.source.license,
        )
      )
        fail(`${at}: photo license is not approved for republication`);
      if (Math.max(entry.photo.width, entry.photo.height) < 600)
        fail(`${at}: photo below common minimum`);
      photos++;
      bytes += entry.photo.bytes;
    }
  }
  if (
    approved > batch.limits.models ||
    photos > batch.limits.photos ||
    bytes > batch.limits.bytes
  )
    fail("Approved package exceeds its explicit limits");
  return {
    batch,
    scope,
    counts: {
      approved,
      photos,
      bytes,
      excluded: batch.entries.length - approved,
    },
  };
}
