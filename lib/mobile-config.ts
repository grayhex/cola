import { z } from "zod";

// What the native apps may change without a new build (#338): content and the
// availability of features the APK already has. Never layout, styles, code or
// secrets: an old APK ignores what it does not know, and a switch cannot create
// a feature the APK lacks. Shared by the admin editor and the server; the
// public form of these settings is built in lib/mobile-settings.ts.

/** Features an app build may have. Turning one off hides it in the app. */
export const mobileFeatures = [
  { key: "chat", label: "Сообщения", gate: "chat" },
  { key: "market", label: "Барахолка", gate: null },
  { key: "componentCatalog", label: "Каталог компонентов", gate: null },
  { key: "rides", label: "Покатушки", gate: null },
  { key: "bikeEditor", label: "Редактор велосипеда", gate: null },
  { key: "journalEditor", label: "Редактор журнала", gate: null },
  { key: "nativeYandexSignIn", label: "Вход через Яндекс ID", gate: "yandex" },
] as const;
export type MobileGate = NonNullable<(typeof mobileFeatures)[number]["gate"]>;

export const linkKeys = [
  "help",
  "privacy",
  "terms",
  "about",
  "support",
] as const;
export type MobileLinkKey = (typeof linkKeys)[number];
export const linkLabels: Record<MobileLinkKey, string> = {
  help: "Помощь",
  privacy: "Персональные данные",
  terms: "Пользовательское соглашение",
  about: "О проекте",
  support: "Поддержка",
};
/** Where a link leads when the admin leaves it empty; support has no default. */
export const defaultLinks = {
  help: "/about#guide",
  privacy: "/legal/privacy",
  terms: "/legal/terms",
  about: "/about",
  support: null,
} as const satisfies Record<MobileLinkKey, string | null>;

export const noticeKinds = ["promo", "service", "maintenance"] as const;
export const contentModes = ["fit", "crop"] as const;
export const updateModes = ["soft", "hard"] as const;

export const MOBILE_LIMITS = Object.freeze({
  onboardingItems: 6,
  features: 40,
  hosts: 20,
  // The largest versionCode Android accepts.
  versionCode: 2_100_000_000,
});
export const featureKeyPattern = /^[a-z][A-Za-z0-9]{0,39}$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Plain text only: the app shows it as text, never as markup. A line refuses
// every control character; a paragraph keeps line breaks and tabs.
const lineControls = /\p{Cc}/u;
const paragraphControls = /(?![\n\t])\p{Cc}/u;
function text(max: number, { min = 0, multiline = false } = {}) {
  return z
    .string()
    .transform((value) => value.replace(/\r\n?/g, "\n").trim())
    .pipe(
      z
        .string()
        .min(min, "Заполните поле")
        .max(max, `Не больше ${max} символов`)
        .refine(
          (value) =>
            !(multiline ? paragraphControls : lineControls).test(value),
          multiline
            ? "Недопустимый символ"
            : "Без переносов строки и служебных символов",
        ),
    );
}
const optionalText = (max: number, multiline = false) =>
  text(max, { multiline })
    .nullable()
    .default(null)
    .transform((value) => value || null);
const assetId = z
  .uuid("Выберите изображение из медиатеки")
  .transform((id) => id.toLowerCase())
  .nullable()
  .default(null);
// A page of the site ("/about") or an https address; checked against the site
// origin and the allowed hosts by mobileSettingsProblems. Empty: the default.
const link = z
  .string()
  .trim()
  .max(500, "Не больше 500 символов")
  .nullable()
  .default(null)
  .transform((value) => value || null);
const versionCode = z
  .int("Укажите целое число")
  .min(1, "Не меньше 1")
  .max(MOBILE_LIMITS.versionCode, `Не больше ${MOBILE_LIMITS.versionCode}`)
  .nullable()
  .default(null);

/** A bare domain name in its ASCII form, or null when it is not one. */
export function normalizeHost(value: string) {
  const input = value.trim().toLowerCase();
  // No scheme, port, path, credentials or spaces: only the name itself.
  if (!input || /[\s/\\:@?#%]/.test(input)) return null;
  let hostname: string;
  try {
    hostname = new URL("https://" + input + "/").hostname;
  } catch {
    return null;
  }
  const labels = hostname.split(".");
  if (
    labels.length < 2 ||
    labels.some((label) => !/^(?!-)[a-z0-9-]{1,63}(?<!-)$/.test(label)) ||
    /^\d+$/.test(labels[labels.length - 1])
  )
    return null;
  return hostname;
}
const host = z
  .string()
  .max(253, "Слишком длинный домен")
  .transform((value, context) => {
    const normalized = normalizeHost(value);
    if (normalized) return normalized;
    context.addIssue({
      code: "custom",
      message: "Укажите домен без https:// и пути, например rustore.ru",
    });
    return z.NEVER;
  });

export function defaultFeatures() {
  return Object.fromEntries(
    mobileFeatures.map(({ key }): [string, boolean] => [key, true]),
  );
}

const launchSchema = z
  .strictObject({
    enabled: z.boolean().default(false),
    assetId,
    // A label for the admin only; the app never receives it.
    name: optionalText(150),
    contentMode: z.enum(contentModes).default("crop"),
    title: optionalText(80),
  })
  .prefault({});
const onboardingSchema = z
  .strictObject({
    enabled: z.boolean().default(false),
    items: z
      .array(
        z.strictObject({
          title: text(80, { min: 1 }),
          body: optionalText(400, true),
          assetId,
        }),
      )
      .max(
        MOBILE_LIMITS.onboardingItems,
        `Не больше ${MOBILE_LIMITS.onboardingItems} карточек`,
      )
      .default([]),
  })
  .prefault({});
const noticeSchema = z
  .strictObject({
    enabled: z.boolean().default(false),
    kind: z.enum(noticeKinds).default("promo"),
    title: text(80).default(""),
    body: optionalText(500, true),
    assetId,
    actionLabel: optionalText(40),
    actionUrl: link,
  })
  .prefault({});
const linksSchema = z
  .strictObject({
    help: link,
    privacy: link,
    terms: link,
    about: link,
    support: link,
  })
  .prefault({});
const featuresSchema = z
  .record(
    z
      .string()
      .regex(
        featureKeyPattern,
        "Ключ функции: латиница и цифры, camelCase, до 40 знаков",
      )
      .refine((key) => !(key in Object.prototype), "Недопустимый ключ"),
    z.boolean(),
  )
  .prefault({})
  .transform((value) => ({ ...defaultFeatures(), ...value }))
  // Counted with the built-in keys the transform adds: a value that passes
  // here is never rejected (and reset) when it is read back.
  .refine(
    (value) => Object.keys(value).length <= MOBILE_LIMITS.features,
    `Не больше ${MOBILE_LIMITS.features} функций вместе со встроенными`,
  );
const compatibilitySchema = z
  .strictObject({
    minimumSupportedVersionCode: versionCode,
    latestVersionCode: versionCode,
    updateMode: z.enum(updateModes).default("soft"),
    updateUrl: link,
    updateMessage: optionalText(300, true),
  })
  .prefault({});

/** The settings as stored and as the admin sends them; every field has a default. */
export const mobileSettingsSchema = z.strictObject({
  launch: launchSchema,
  onboarding: onboardingSchema,
  notice: noticeSchema,
  links: linksSchema,
  externalHosts: z
    .array(host)
    .max(MOBILE_LIMITS.hosts, `Не больше ${MOBILE_LIMITS.hosts} доменов`)
    .default([])
    .transform((hosts) => [...new Set(hosts)]),
  features: featuresSchema,
  compatibility: compatibilitySchema,
});
export type MobileSettings = z.output<typeof mobileSettingsSchema>;

export const defaultMobileSettings = (): MobileSettings =>
  mobileSettingsSchema.parse({});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/**
 * Stored settings for reading. A block that no longer parses (written by a
 * newer version before a rollback, say) falls back to its defaults alone, so
 * one bad block never takes the others or the public answer down.
 */
export function storedMobileSettings(raw: unknown): MobileSettings {
  const whole = mobileSettingsSchema.safeParse(raw);
  if (whole.success) return whole.data;
  const source = isRecord(raw) ? raw : {};
  const block = <T extends z.ZodType>(
    schema: T,
    value: unknown,
  ): z.output<T> => {
    const parsed = schema.safeParse(value);
    return parsed.success ? parsed.data : schema.parse(undefined);
  };
  const { shape } = mobileSettingsSchema;
  return {
    launch: block(shape.launch, source.launch),
    onboarding: block(shape.onboarding, source.onboarding),
    notice: block(shape.notice, source.notice),
    links: block(shape.links, source.links),
    externalHosts: block(shape.externalHosts, source.externalHosts),
    features: block(shape.features, source.features),
    compatibility: block(shape.compatibility, source.compatibility),
  };
}

/**
 * Every asset the settings name, enabled or not, sorted: the lock order of
 * saves and cleanup. Reads raw stored JSON too, so protection never depends on
 * the value still parsing.
 */
export function mobileAssetIds(value: unknown) {
  const ids: unknown[] = [];
  if (isRecord(value)) {
    const { launch, onboarding, notice } = value;
    if (isRecord(launch)) ids.push(launch.assetId);
    if (isRecord(notice)) ids.push(notice.assetId);
    if (isRecord(onboarding) && Array.isArray(onboarding.items))
      for (const item of onboarding.items)
        if (isRecord(item)) ids.push(item.assetId);
  }
  return [
    ...new Set(
      ids
        .filter(
          (id): id is string => typeof id === "string" && uuidPattern.test(id),
        )
        .map((id) => id.toLowerCase()),
    ),
  ].sort();
}

type LinkResult = { href: string } | { problem: string };
// A link the app may open: a page of this site, or https on an allowed host.
// No credentials, other schemes (javascript:, intent:, app schemes) or ports.
function checkLink(
  value: string,
  origin: string,
  hosts: readonly string[],
): LinkResult {
  if (/[\s\\]|\p{Cc}/u.test(value))
    return { problem: "Без пробелов и обратной косой черты" };
  const site = new URL(origin);
  if (value.startsWith("/")) {
    if (value.startsWith("//"))
      return { problem: "Страница сайта начинается с одной косой черты" };
    return { href: new URL(value, site).href };
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { problem: "Укажите страницу сайта (/about) или адрес https://…" };
  }
  if (url.username || url.password)
    return { problem: "Адрес без логина и пароля" };
  if (url.origin === site.origin) return { href: url.href };
  if (url.protocol !== "https:")
    return { problem: "Внешний адрес — только https://" };
  if (url.port) return { problem: "Внешний адрес без порта" };
  if (!hosts.includes(url.hostname))
    return {
      problem: `Домен ${url.hostname} не в списке разрешённых внешних доменов`,
    };
  return { href: url.href };
}
/** Why the app may not open this link, or null when it may. */
export function linkProblem(
  value: string,
  origin: string,
  hosts: readonly string[],
) {
  const result = checkLink(value, origin, hosts);
  return "problem" in result ? result.problem : null;
}
/** The absolute address the app receives, or null when the link is not allowed. */
export function mobileLinkHref(
  value: string,
  origin: string,
  hosts: readonly string[],
) {
  const result = checkLink(value, origin, hosts);
  return "href" in result ? result.href : null;
}

export type MobileProblem = { path: string; message: string };
/** Rules across fields, checked on every save. Empty when the value may be saved. */
export function mobileSettingsProblems(
  value: MobileSettings,
  origin: string,
): MobileProblem[] {
  const problems: MobileProblem[] = [];
  const add = (path: string, message: string) =>
    problems.push({ path, message });
  const { launch, onboarding, notice, links, compatibility } = value;
  if (launch.enabled && !launch.assetId)
    add(
      "launch.assetId",
      "Выберите изображение экрана запуска или выключите его",
    );
  if (onboarding.enabled && !onboarding.items.length)
    add("onboarding.items", "Добавьте карточку или выключите знакомство");
  if (notice.enabled && !notice.title)
    add("notice.title", "Укажите заголовок сообщения");
  if (!notice.actionLabel !== !notice.actionUrl)
    add(
      notice.actionLabel ? "notice.actionUrl" : "notice.actionLabel",
      "Для кнопки нужны и текст, и ссылка",
    );
  const check = (path: string, url: string | null) => {
    const problem = url && linkProblem(url, origin, value.externalHosts);
    if (problem) add(path, problem);
  };
  check("notice.actionUrl", notice.actionUrl);
  for (const key of linkKeys) check("links." + key, links[key]);
  check("compatibility.updateUrl", compatibility.updateUrl);
  const {
    minimumSupportedVersionCode: minimum,
    latestVersionCode: latest,
    updateMode,
    updateUrl,
  } = compatibility;
  if (minimum !== null && latest !== null && minimum > latest)
    add(
      "compatibility.latestVersionCode",
      "Последняя версия не может быть меньше минимальной",
    );
  if (updateMode === "hard" && minimum === null)
    add(
      "compatibility.minimumSupportedVersionCode",
      "Для обязательного обновления укажите минимальную версию",
    );
  if (updateMode === "hard" && !updateUrl)
    add(
      "compatibility.updateUrl",
      "Для обязательного обновления укажите ссылку на обновление",
    );
  return problems;
}

export type MobileConfirmation = "hardUpdate" | "maintenance";
const hardUpdate = (value: MobileSettings) =>
  value.compatibility.updateMode === "hard";
const maintenance = (value: MobileSettings) =>
  value.notice.enabled && value.notice.kind === "maintenance";
/**
 * High-impact changes the admin must confirm explicitly: blocking old app
 * versions (turning the hard mode on or raising its minimum) and publishing a
 * maintenance notice.
 */
export function confirmationsNeeded(
  before: MobileSettings,
  after: MobileSettings,
): MobileConfirmation[] {
  const needed: MobileConfirmation[] = [];
  const minimum = (value: MobileSettings) =>
    value.compatibility.minimumSupportedVersionCode ?? 0;
  if (
    hardUpdate(after) &&
    (!hardUpdate(before) || minimum(after) > minimum(before))
  )
    needed.push("hardUpdate");
  if (maintenance(after) && !maintenance(before)) needed.push("maintenance");
  return needed;
}

/** Blocks whose content differs: a new edition of them gets a new revision. */
export function changedBlocks(before: MobileSettings, after: MobileSettings) {
  return {
    onboarding:
      JSON.stringify(before.onboarding) !== JSON.stringify(after.onboarding),
    notice: JSON.stringify(before.notice) !== JSON.stringify(after.notice),
  };
}
