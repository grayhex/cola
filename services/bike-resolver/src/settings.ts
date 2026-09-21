import { z } from "zod";
import type { Pool } from "pg";
export const adapterSupport = {
  cube: "Архив перенаправляет на портал без публичной комплектации",
  specialized: "",
  canyon: "",
  giant: "",
  trek: "Страница не содержит доступной спецификации",
  cannondale: "Модельный год не подтверждён источником",
  scott: "Страница не содержит доступной спецификации",
  orbea: "Защита сайта ограничивает доступ",
  merida: "",
  gt: "",
  bmc: "Модельный год не подтверждён источником",
};
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
          Object.keys(adapterSupport).map((k) => [k, k === "gt" ? z.boolean().default(true) : z.boolean()]),
        ),
      )
      .strict(),
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
