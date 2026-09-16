import type { Settings } from "./settings.js";
import type { Pool } from "pg";
import type { BikeQuery, ResolveResult } from "./domain.js";
export const SUCCESS_TTL = 90 * 86400000,
  NOT_FOUND_TTL = 86400000;
export interface Cache {
  get(
    key: string,
    adapter: string,
    version: number,
  ): Promise<ResolveResult | null>;
  put(
    key: string,
    q: BikeQuery,
    result: ResolveResult,
    adapter: string,
    version: number,
    hash?: string,
  ): Promise<void>;
  ready(): Promise<void>;
  clear?(adapter?: string): Promise<void>;
}
export class PostgresCache implements Cache {
  constructor(
    private db: Pool,
    private settings?: () => Settings,
  ) {}
  async clear(adapter?: string) {
    await this.db.query(
      "DELETE FROM bike_resolver.cache WHERE ($1::text IS NULL OR adapter=$1)",
      [adapter || null],
    );
  }
  async ready() {
    await this.db.query("SELECT query_key FROM bike_resolver.cache LIMIT 0");
  }
  async get(key: string, adapter: string, version: number) {
    const { rows } = await this.db.query(
      "SELECT response FROM bike_resolver.cache WHERE query_key=$1 AND adapter=$2 AND adapter_version=$3 AND expires_at>now()",
      [key, adapter, version],
    );
    return rows[0]?.response || null;
  }
  async put(
    key: string,
    q: BikeQuery,
    result: ResolveResult,
    adapter: string,
    version: number,
    hash?: string,
  ) {
    if (!["resolved", "not_found"].includes(result.status)) return;
    await this.db.query(
      `INSERT INTO bike_resolver.cache(query_key,query,status,response,source_url,source_hash,adapter,adapter_version,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(query_key) DO UPDATE SET query=excluded.query,status=excluded.status,response=excluded.response,source_url=excluded.source_url,source_hash=excluded.source_hash,adapter=excluded.adapter,adapter_version=excluded.adapter_version,updated_at=now(),last_checked_at=now(),expires_at=excluded.expires_at`,
      [
        key,
        q,
        result.status,
        result,
        result.status === "resolved" ? result.source.url : null,
        hash || null,
        adapter,
        version,
        new Date(
          Date.now() +
            (result.status === "resolved"
              ? (this.settings?.().successTtlDays ?? 90) * 86400000
              : (this.settings?.().negativeTtlHours ?? 24) * 3600000),
        ),
      ],
    );
  }
}
export class MemoryCache implements Cache {
  private data = new Map<
    string,
    { adapter: string; version: number; result: ResolveResult; expires: number }
  >();
  async ready() {}
  async clear(adapter?: string) {
    for (const [key, value] of this.data)
      if (!adapter || value.adapter === adapter) this.data.delete(key);
  }
  async get(key: string, adapter: string, version: number) {
    const v = this.data.get(key);
    return v &&
      v.adapter === adapter &&
      v.version === version &&
      v.expires > Date.now()
      ? structuredClone(v.result)
      : null;
  }
  async put(
    key: string,
    _q: BikeQuery,
    result: ResolveResult,
    adapter: string,
    version: number,
  ) {
    if (!["resolved", "not_found"].includes(result.status)) return;
    this.data.set(key, {
      adapter,
      version,
      result: structuredClone(result),
      expires:
        Date.now() +
        (result.status === "resolved" ? SUCCESS_TTL : NOT_FOUND_TTL),
    });
  }
}
