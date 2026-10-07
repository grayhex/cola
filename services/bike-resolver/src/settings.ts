import { z } from "zod";
import type { Pool } from "pg";
export const adapterSupport = {
  cube: "Архив перенаправляет на портал без публичной комплектации",
  specialized: "",
  canyon: "",
  giant: "",
  trek: "",
  cannondale: "",
  scott: "Страница не содержит доступной спецификации",
  orbea: "Защита сайта ограничивает доступ",
  merida: "",
  gt: "",
  bmc: "Модельный год не подтверждён источником",
  rose: "",
  sava: "",
  shulz: "",
  twitter: "",
};
// What a result of an adapter that is switched on still does not say. Shown to
// the operator and in /v1/brands; a note never switches an adapter off.
export const adapterNotes: Partial<
  Record<keyof typeof adapterSupport, string>
> = {
  rose: "ROSE не публикует модельный год: страницы текущего каталога и более старые страницы показываются как варианты, год указывает владелец",
  sava: "На странице два описания комплектации; при расхождении берётся структурированный блок, различие отмечается",
  shulz:
    "Год на странице не указан; цвета и размеры одной модели — одна комплектация, рамы без велосипеда не предлагаются",
  twitter:
    "Официальный дистрибьютор в США (twitterbikeusa.com): сайт производителя публикует пустые таблицы. Одна страница — несколько сборок, каждая отдельным вариантом",
};
// Adapters added after the first release: settings saved without their flag
// still load and take the default.
const laterAdapters = new Set(["gt", "rose", "sava", "shulz", "twitter"]);
// Registered retailers. `enabled` is the default for installations that never
// saved the flag; the text is shown to the operator and in /v1/brands.
export const storeSupport = {
  velosklad: { enabled: true, limitation: "" },
  bikeinn: {
    enabled: true,
    limitation:
      "Поиск идёт по публичной карте сайта, в ней не все товары; страница по ссылке читается всегда",
  },
  alltricks: {
    enabled: false,
    limitation:
      "Поиска нет: сайт отвечает серверным запросам проверкой Cloudflare. Страница по ссылке читается, если сеть сервера её получает",
  },
  bike24: {
    enabled: false,
    limitation:
      "Сайт отклоняет автоматические запросы; поиск и разбор не проверены на реальных страницах",
  },
} as const;
export type StoreId = keyof typeof storeSupport;
export const settingsSchema = z
  .object({
    enabled: z.boolean(),
    autoResolve: z.boolean(),
    blockedDomains: z
      .array(
        z.string().regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/),
      )
      .max(40)
      .default([]),
    photoSearch: z.boolean().default(true),
    retailerSearch: z.boolean().default(true),
    timeoutMs: z.number().int().min(3000).max(20000),
    requestIntervalMs: z.number().int().min(500).max(5000),
    successTtlDays: z.number().int().min(30).max(730),
    negativeTtlHours: z.number().int().min(1).max(48),
    adapters: z
      .object(
        Object.fromEntries(
          Object.keys(adapterSupport).map((k) => [
            k,
            laterAdapters.has(k)
              ? z
                  .boolean()
                  .default(!adapterSupport[k as keyof typeof adapterSupport])
              : z.boolean(),
          ]),
        ),
      )
      .strict(),
    // A missing key takes its default: settings saved before a store existed
    // load unchanged and never lose an operator's choice for the others.
    stores: z
      .object(
        Object.fromEntries(
          Object.entries(storeSupport).map(([k, v]) => [
            k,
            z.boolean().default(v.enabled),
          ]),
        ) as Record<StoreId, z.ZodDefault<z.ZodBoolean>>,
      )
      .strict()
      .prefault({}),
  })
  .strict();
export type Settings = z.infer<typeof settingsSchema>;
export const defaultSettings: Settings = {
  enabled: true,
  autoResolve: true,
  blockedDomains: [],
  photoSearch: true,
  retailerSearch: true,
  timeoutMs: 10000,
  requestIntervalMs: 700,
  successTtlDays: 90,
  negativeTtlHours: 24,
  adapters: Object.fromEntries(
    Object.entries(adapterSupport).map(([id, reason]) => [id, !reason]),
  ),
  stores: Object.fromEntries(
    Object.entries(storeSupport).map(([id, v]) => [id, v.enabled]),
  ) as Record<StoreId, boolean>,
};
export class SettingsStore {
  value: Settings = structuredClone(defaultSettings);
  version = 1;
  constructor(private db?: Pool) {}
  async load() {
    if (!this.db) return;
    const { rows } = await this.db.query(
      "SELECT value,version FROM bike_resolver.settings WHERE id=1",
    );
    if (rows[0]) {
      const { manualDomains: _legacyAllowlist, ...current } = rows[0].value;
      this.value = settingsSchema.parse(current);
      this.version = rows[0].version;
    }
  }
  async save(value: unknown, version: number) {
    const parsed = settingsSchema.parse(value);
    if (this.db) {
      const r = await this.db.query(
        "UPDATE bike_resolver.settings SET value=$1,version=version+1 WHERE id=1 AND version=$2 RETURNING version",
        [parsed, version],
      );
      if (!r.rows.length) return false;
      this.version = r.rows[0].version;
    } else {
      if (version !== this.version) return false;
      this.version++;
    }
    this.value = parsed;
    return true;
  }
}
