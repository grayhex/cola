import { archiveLinks } from "./archive-search.js";
import { candidateIdOf, type CandidateRegistry } from "./candidate-registry.js";
import {
  checkAbort,
  quiet,
  trace,
  withinBudget,
  type Reason,
} from "./context.js";
import {
  ResolverError,
  type BikeCandidate,
  type BikeManufacturerAdapter,
  type BikeQuery,
  type Resolved,
  type ResolveResult,
  type SearchReport,
  type SourceKind,
  type SourceReport,
  type SourceStatus,
} from "./domain.js";
import type { ManufacturerHttpClient } from "./http.js";
import { identityConflict } from "./identity.js";
import type { ManualSources } from "./manual.js";
import { partialScore } from "./matcher.js";
import { normalize } from "./normalize.js";
import { webLinks } from "./retailer-search.js";
import type { SettingsStore, StoreId } from "./settings.js";
import { sourceIdentity } from "./source-url.js";
import type { RetailStore } from "./stores/types.js";

// One search is bounded in time, pages and fan-out; none of it is hidden. The
// numbers are documented in docs/resolver/architecture.md.
export const LIMITS = {
  officialMs: 20000,
  archiveMs: 12000,
  storeMs: 14000,
  webMs: 12000,
  pageMs: 12000,
  officialPages: 6,
  archivePages: 6,
  // Pages verified across all searchable stores; each gets an equal share.
  storePages: 12,
  perStoreMax: 4,
  webPages: 3,
  candidates: 12,
} as const;

export const adapterFor = (
  adapters: BikeManufacturerAdapter[],
  brand: string,
) =>
  adapters.find((a) =>
    [a.brand, ...a.aliases].some((b) => normalize(b) === normalize(brand)),
  );

const statusOf = (reason?: Reason): SourceStatus => {
  if (
    reason === "http_403" ||
    reason === "access_challenge" ||
    reason === "http_429" ||
    reason === "blocked_source"
  )
    return "blocked";
  if (reason === "timeout" || reason === "aborted") return "timeout";
  return "unavailable";
};
// A failed request is a problem of the source; an unreadable or foreign page is
// only a rejected page.
const network = new Set<Reason | undefined>([
  "http_403",
  "access_challenge",
  "http_429",
  "blocked_source",
  "timeout",
  "aborted",
  "connection_failed",
  "dns_failed",
  "http_error",
]);
// A budget that ran out surfaces as a TimeoutError of the derived signal.
const reasonOf = (e: unknown): Reason =>
  e instanceof ResolverError
    ? e.reason
    : e instanceof Error &&
        (e.name === "TimeoutError" || e.name === "AbortError")
      ? "timeout"
      : "connection_failed";

interface Verified {
  candidate: BikeCandidate;
  resolved: Resolved;
}
interface Outcome {
  report: SourceReport;
  verified: Verified[];
  truncated: boolean;
}
export type Limits = { -readonly [K in keyof typeof LIMITS]: number };
export interface SearchDeps {
  // Tests shrink the time and page budgets; production uses LIMITS as is.
  limits?: Partial<Limits>;
  adapters: BikeManufacturerAdapter[];
  http: ManufacturerHttpClient;
  manual: ManualSources;
  settings: SettingsStore;
  stores: RetailStore[];
  registry: CandidateRegistry;
}

const drivetrain = (r: Resolved) => {
  const pick = (type: string) =>
    r.components.find((c) => c.type === type)?.description;
  const text =
    pick("rear_derailleur") || pick("shifter") || pick("crankset") || "";
  return text ? text.replace(/\s+/g, " ").slice(0, 70) : undefined;
};
function candidateOf(
  query: BikeQuery,
  resolved: Resolved,
  fallback: SourceKind,
  store?: RetailStore,
): Verified | undefined {
  const kind = resolved.source.kind ?? fallback,
    name = resolved.bike.canonicalName,
    year = resolved.sourceYear ?? null;
  const score = partialScore(
    query,
    (kind === "manufacturer" ? query.brand + " " : "") + name,
    year,
  );
  if (!score) return undefined;
  const owner = store ?? undefined;
  return {
    resolved,
    candidate: {
      candidateId: candidateIdOf(resolved.source.url),
      brand: query.brand,
      canonicalName: name,
      url: resolved.source.url,
      year,
      score,
      thumbnailId: resolved.thumbnailId,
      sourceHost: new URL(resolved.source.url).hostname,
      selectable: true,
      kind,
      ...(resolved.source.storeId
        ? {
            storeId: resolved.source.storeId,
            storeName: resolved.source.manufacturer,
          }
        : owner
          ? { storeId: owner.id, storeName: owner.name }
          : {}),
      ...(resolved.quality
        ? {
            quality: {
              level: resolved.quality.level,
              recognizedComponents: resolved.quality.recognizedComponents,
              coverage: Math.round(resolved.quality.coverage * 100) / 100,
            },
          }
        : {}),
      ...(drivetrain(resolved) ? { drivetrain: drivetrain(resolved) } : {}),
      ...(resolved.warnings?.length ? { warnings: resolved.warnings } : {}),
      ...(resolved.bike.manufacturerProductId
        ? { manufacturerProductId: resolved.bike.manufacturerProductId }
        : {}),
    },
  };
}
// Official page whose identity is the request: nothing weaker needs consulting.
function exact(query: BikeQuery, c: BikeCandidate) {
  const words = new Set(
    normalize(
      (c.kind === "manufacturer" ? query.brand + " " : "") + c.canonicalName,
    ).split(" "),
  );
  return (
    normalize([query.brand, query.model, query.trim].filter(Boolean).join(" "))
      .split(" ")
      .every((w) => words.has(w)) &&
    (query.year === null || c.year === query.year)
  );
}
// The chosen page is judged against the query it is chosen for, which may
// differ from the one it was found with (a bike form has its own year).
function judged(query: BikeQuery, resolved: Resolved): Resolved {
  const conflict = identityConflict(
    query,
    [
      resolved.source.kind === "manufacturer" ? query.brand : undefined,
      resolved.bike.canonicalName,
    ]
      .filter(Boolean)
      .join(" "),
    resolved.sourceYear ?? null,
  );
  const warnings = (resolved.warnings ?? []).filter(
    (w) => w !== "identity_mismatch",
  );
  return {
    ...resolved,
    query,
    bike: { ...resolved.bike, ...query },
    warnings: conflict ? [...warnings, "identity_mismatch"] : warnings,
    cached: false,
  };
}
const kindRank: Record<SourceKind, number> = {
  manufacturer: 0,
  archive: 1,
  store: 2,
  web: 3,
  manual: 4,
};

export class SourceSearch {
  // Discovery answers (not verified pages) for a repeated query; failures are
  // never remembered, so an outage does not outlive itself.
  private discovered = new Map<string, { urls: string[]; expires: number }>();
  private limits: Limits;
  constructor(private deps: SearchDeps) {
    this.limits = { ...LIMITS, ...deps.limits };
  }
  private async discovery(
    source: string,
    query: BikeQuery,
    run: () => Promise<string[]>,
  ) {
    const key = JSON.stringify([
      source,
      normalize(query.brand),
      normalize(query.model),
      normalize(query.trim),
      query.year,
    ]);
    const hit = this.discovered.get(key);
    if (hit && hit.expires > Date.now()) return hit.urls;
    const urls = await run();
    if (this.discovered.size >= 100)
      this.discovered.delete(this.discovered.keys().next().value!);
    this.discovered.set(key, { urls, expires: Date.now() + 30 * 60000 });
    return urls;
  }

  // Official source and archive first; stores and web only when those did not
  // find the exact model, so a weaker source never outvotes an official one.
  async all(query: BikeQuery): Promise<ResolveResult> {
    trace("discovery_started");
    const primary = await this.primary(query);
    const sure = primary.some((o) =>
      o.verified.some((v) => exact(query, v.candidate)),
    );
    const secondary =
      sure || !this.deps.settings.value.retailerSearch
        ? []
        : await this.secondary(query);
    return this.finish(query, [...primary, ...secondary]);
  }

  // Registered stores and web search, for a request the official source failed.
  async stores(query: BikeQuery): Promise<ResolveResult> {
    return this.finish(query, await this.secondary(query));
  }

  // Resolves exactly the page a previous result offered. Never searches again.
  async select(
    query: BikeQuery,
    candidateId: string,
  ): Promise<ResolveResult | undefined> {
    const known = this.deps.registry.get(candidateId);
    if (!known) return undefined;
    trace("candidate_selected", { host: new URL(known.url).hostname });
    if (known.resolved) {
      // The page was read and verified while searching: say so, don't pretend
      // to fetch it again.
      trace("cache_hit");
      trace("components_recognized", {
        count: known.resolved.components.length,
        ...(known.resolved.quality
          ? { total: known.resolved.quality.totalFields }
          : {}),
      });
      return judged(query, known.resolved);
    }
    return (await this.deps.manual.resolve(
      query,
      known.url,
      known.kind,
    )) as ResolveResult;
  }

  private async page(
    query: BikeQuery,
    url: string,
    kind: SourceKind,
    store?: RetailStore,
  ): Promise<{ verified?: Verified; failure?: Reason }> {
    const result = (await withinBudget(this.limits.pageMs, () =>
      quiet(() => this.deps.manual.resolve(query, url, kind)),
    )) as ResolveResult;
    if (result.status !== "resolved")
      return { failure: "reason" in result ? result.reason : undefined };
    if (result.components.length < 3) return {};
    const verified = candidateOf(query, result, kind, store);
    return verified ? { verified } : {};
  }

  private report(
    id: string,
    name: string,
    kind: SourceKind,
    started: number,
    status: SourceStatus,
    extra: { reason?: Reason; pages?: number; verified?: Verified[] } = {},
  ): SourceReport {
    return {
      id,
      name,
      kind,
      status,
      ...(extra.reason ? { reason: extra.reason } : {}),
      pages: extra.pages ?? 0,
      candidates: extra.verified?.length ?? 0,
      durationMs: Date.now() - started,
    };
  }

  // Verifies pages one by one: a host is queued by the HTTP client anyway.
  private async verify(
    query: BikeQuery,
    urls: string[],
    kind: SourceKind,
    store?: RetailStore,
  ) {
    const verified: Verified[] = [];
    let failure: Reason | undefined;
    for (const url of urls) {
      checkAbort();
      const result = await this.page(query, url, kind, store);
      if (result.verified) verified.push(result.verified);
      else if (network.has(result.failure)) failure ??= result.failure;
    }
    // A failure stays visible even when other pages were merely irrelevant:
    // the page that never answered might have been the one.
    return { verified, failure };
  }

  private async primary(query: BikeQuery): Promise<Outcome[]> {
    const { adapters, settings, http } = this.deps;
    const adapter = adapterFor(adapters, query.brand);
    const jobs: Promise<Outcome>[] = [];
    if (adapter)
      jobs.push(
        (async () => {
          const started = Date.now();
          const make = (
            status: SourceStatus,
            extra: Parameters<SourceSearch["report"]>[5] = {},
          ): Outcome => ({
            report: this.report(
              adapter.id,
              adapter.brand,
              "manufacturer",
              started,
              status,
              extra,
            ),
            verified: extra.verified ?? [],
            truncated: false,
          });
          if (!settings.value.adapters[adapter.id]) return make("disabled");
          try {
            const urls = await withinBudget(
              this.limits.officialMs,
              async () => {
                const found = await adapter.discover(query);
                return found
                  .filter(
                    (c) =>
                      partialScore(
                        query,
                        query.brand + " " + c.canonicalName,
                        c.year,
                      ) > 0,
                  )
                  .sort(
                    (a, b) =>
                      partialScore(
                        query,
                        query.brand + " " + b.canonicalName,
                        b.year,
                      ) -
                      partialScore(
                        query,
                        query.brand + " " + a.canonicalName,
                        a.year,
                      ),
                  )
                  .slice(0, this.limits.officialPages)
                  .map((c) => c.url);
              },
            );
            trace("candidate_found", { count: urls.length });
            const r = await this.verify(query, urls, "manufacturer");
            return make(
              r.verified.length
                ? "ok"
                : r.failure
                  ? statusOf(r.failure)
                  : "empty",
              { verified: r.verified, pages: urls.length, reason: r.failure },
            );
          } catch (e) {
            checkAbort();
            const reason = reasonOf(e);
            return make(statusOf(reason), { reason });
          }
        })(),
      );
    if (
      settings.value.retailerSearch &&
      query.year !== null &&
      query.year < new Date().getUTCFullYear()
    )
      jobs.push(
        (async () => {
          const started = Date.now();
          try {
            const urls = (
              await withinBudget(this.limits.archiveMs, () =>
                quiet(() => archiveLinks(http, query)),
              )
            ).slice(0, this.limits.archivePages);
            const r = await this.verify(query, urls, "archive");
            return {
              report: this.report(
                "archive",
                "Архив моделей",
                "archive",
                started,
                r.verified.length
                  ? "ok"
                  : r.failure
                    ? statusOf(r.failure)
                    : "empty",
                { verified: r.verified, pages: urls.length, reason: r.failure },
              ),
              verified: r.verified,
              truncated: false,
            };
          } catch (e) {
            checkAbort();
            const reason = reasonOf(e);
            return {
              report: this.report(
                "archive",
                "Архив моделей",
                "archive",
                started,
                statusOf(reason),
                { reason },
              ),
              verified: [],
              truncated: false,
            };
          }
        })(),
      );
    return Promise.all(jobs);
  }

  private async secondary(query: BikeQuery): Promise<Outcome[]> {
    const { stores, settings } = this.deps;
    const searchable = stores.filter(
      (s) => s.search && settings.value.stores[s.id as StoreId],
    );
    trace("retailer_search_started", { count: searchable.length });
    const pages = Math.max(
      1,
      Math.min(
        this.limits.perStoreMax,
        Math.floor(this.limits.storePages / Math.max(1, searchable.length)),
      ),
    );
    return Promise.all([
      ...stores.map((store) => this.store(store, query, pages)),
      this.web(query),
    ]);
  }

  private async store(
    store: RetailStore,
    query: BikeQuery,
    pages: number,
  ): Promise<Outcome> {
    const started = Date.now(),
      host = store.allowedDomains[0];
    const make = (
      status: SourceStatus,
      extra: Parameters<SourceSearch["report"]>[5] & {
        truncated?: boolean;
      } = {},
    ): Outcome => ({
      report: this.report(
        store.id,
        store.name,
        "store",
        started,
        status,
        extra,
      ),
      verified: extra.verified ?? [],
      truncated: !!extra.truncated,
    });
    if (!this.deps.settings.value.stores[store.id as StoreId])
      return make("disabled");
    if (!store.discover) return make("skipped");
    let urls: string[];
    try {
      urls = await this.discovery(store.id, query, () =>
        withinBudget(this.limits.storeMs, () =>
          quiet(() =>
            store.discover!(query, { http: this.deps.http, limit: pages }),
          ),
        ),
      );
    } catch (e) {
      checkAbort();
      const reason = reasonOf(e);
      trace("source_failed", { host, reason });
      return make(statusOf(reason), { reason });
    }
    try {
      const checked = urls.slice(0, pages);
      const r = await this.verify(query, checked, "store", store);
      trace("store_checked", {
        host,
        count: r.verified.length,
        total: checked.length,
      });
      if (!r.verified.length && r.failure)
        trace("source_failed", { host, reason: r.failure });
      return make(
        r.verified.length ? "ok" : r.failure ? statusOf(r.failure) : "empty",
        {
          verified: r.verified,
          pages: checked.length,
          reason: r.verified.length ? undefined : r.failure,
          truncated: urls.length > checked.length || !!store.partial,
        },
      );
    } catch (e) {
      checkAbort();
      const reason = reasonOf(e);
      return make(statusOf(reason), { reason });
    }
  }

  // A search engine only suggests pages; each is fetched and verified.
  private async web(query: BikeQuery): Promise<Outcome> {
    const started = Date.now(),
      name = "Поиск в интернете";
    const make = (
      status: SourceStatus,
      extra: Parameters<SourceSearch["report"]>[5] = {},
    ): Outcome => ({
      report: this.report("web", name, "web", started, status, extra),
      verified: extra.verified ?? [],
      // A few suggested pages are never the whole web.
      truncated: true,
    });
    try {
      const urls = (
        await this.discovery("web", query, () =>
          withinBudget(this.limits.webMs, () =>
            quiet(() => webLinks(this.deps.http, query, this.limits.webPages)),
          ),
        )
      ).slice(0, this.limits.webPages);
      const r = await this.verify(query, urls, "web");
      return make(
        r.verified.length ? "ok" : r.failure ? statusOf(r.failure) : "empty",
        { verified: r.verified, pages: urls.length, reason: r.failure },
      );
    } catch (e) {
      checkAbort();
      const reason = reasonOf(e);
      trace("source_failed", { reason });
      return make(statusOf(reason), { reason });
    }
  }

  private finish(query: BikeQuery, outcomes: Outcome[]): ResolveResult {
    const { stores, registry } = this.deps;
    // The same product behind several URLs is one choice with its other links.
    const unique = new Map<string, Verified>();
    for (const v of outcomes.flatMap((o) => o.verified)) {
      const url = new URL(v.candidate.url),
        owner = stores.find((s) => s.owns(url)),
        id = owner?.productKey(url),
        key =
          owner && id ? owner.id + ":" + id : sourceIdentity(v.candidate.url),
        first = unique.get(key);
      if (!first) unique.set(key, v);
      else
        (first.candidate.alternatives ??= []).push({
          url: v.candidate.url,
          sourceHost: url.hostname,
        });
    }
    // A confirmed other year sinks below matching and unconfirmed ones.
    const fit = (c: BikeCandidate) =>
      query.year === null || c.year === query.year
        ? 0
        : c.year === null
          ? 1
          : 2;
    const ranked = [...unique.values()]
      .sort(
        (a, b) =>
          fit(a.candidate) - fit(b.candidate) ||
          kindRank[a.candidate.kind ?? "manual"] -
            kindRank[b.candidate.kind ?? "manual"] ||
          (b.candidate.score ?? 0) - (a.candidate.score ?? 0) ||
          (b.candidate.quality?.recognizedComponents ?? 0) -
            (a.candidate.quality?.recognizedComponents ?? 0) ||
          a.candidate.url.localeCompare(b.candidate.url),
      )
      .slice(0, this.limits.candidates);
    for (const v of ranked) registry.remember(v.candidate, v.resolved);
    trace("candidate_found", { count: ranked.length });
    const sources = outcomes.map((o) => o.report);
    const search: SearchReport = {
      // Never "complete": store catalogues are searched only in part.
      complete: outcomes.every(
        (o) =>
          ["ok", "empty", "disabled"].includes(o.report.status) && !o.truncated,
      ),
      sources,
    };
    if (ranked.length)
      return {
        status: "ambiguous",
        query,
        candidates: ranked.map((v) => v.candidate),
        cached: false,
        search,
      };
    const failed = sources.find((s) =>
      ["blocked", "timeout", "unavailable"].includes(s.status),
    );
    return {
      status: failed ? "upstream_unavailable" : "not_found",
      query,
      brand: query.brand,
      retryable: !!failed,
      cached: false,
      ...(failed?.reason ? { reason: failed.reason } : {}),
      search,
    };
  }
}
