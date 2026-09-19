import {
  trace,
  checkAbort,
  EXTRACTOR_VERSION,
  RESULT_SCHEMA_VERSION,
  resolutionContext,
} from "./context.js";
import { sourceIdentity } from "./source-url.js";
import { createHash } from "node:crypto";
import type { Logger } from "pino";
import {
  querySchema,
  requestSchema,
  ResolverError,
  type BikeManufacturerAdapter,
  type BikeQuery,
  type ResolveResult,
} from "./domain.js";
import type { Cache } from "./cache.js";
import { normalize, queryKey } from "./normalize.js";
import {
  match,
  scoreCandidate,
  MATCH_THRESHOLD,
  EXPLICIT_MATCH_THRESHOLD,
} from "./matcher.js";
export class Resolver {
  private pending = new Map<string, Promise<ResolveResult>>();
  constructor(
    public adapters: BikeManufacturerAdapter[],
    private cache: Cache,
    private logger: Logger,
  ) {}
  async resolve(
    input: unknown,
    requestId = "internal",
  ): Promise<ResolveResult> {
    const { candidateId, ...query } = requestSchema.parse(input);
    const q = querySchema.parse(query);
    q.trim = q.trim || null;
    checkAbort();
    const start = Date.now();
    const adapter = this.adapters.find((a) =>
      [a.brand, ...a.aliases].some((b) => normalize(b) === normalize(q.brand)),
    );
    if (!adapter)
      return {
        status: "unsupported_brand",
        query: q,
        brand: q.brand,
        retryable: false,
        cached: false,
      };
    q.brand = adapter.brand;
    const key =
      `extractor:${EXTRACTOR_VERSION}:schema:${RESULT_SCHEMA_VERSION}|` +
      queryKey(q) +
      (candidateId ? "|" + candidateId : "");
    let result: ResolveResult;
    try {
      trace("cache_checked");
      const hit = await this.cache.get(key, adapter.id, adapter.adapterVersion);
      if (hit) {
        trace("cache_hit");
        result = { ...hit, query: q, cached: true };
      } else {
        // Independent streaming requests retain their own abort and event context.
        const scoped = !!resolutionContext.getStore();
        let task = scoped ? undefined : this.pending.get(key);
        if (!task) {
          task = this.uncached(q, adapter, requestId, candidateId, key);
          if (!scoped) this.pending.set(key, task);
        }
        try {
          result = await task;
        } finally {
          if (this.pending.get(key) === task) this.pending.delete(key);
        }
      }
    } catch (e) {
      this.logger.error({
        requestId,
        adapter: adapter.id,
        error: e instanceof Error ? e.message : "unknown",
      });
      result = {
        status: e instanceof ResolverError ? e.status : "upstream_unavailable",
        query: q,
        brand: q.brand,
        retryable: e instanceof ResolverError ? e.retryable : true,
        cached: false,
        reason: e instanceof ResolverError ? e.reason : "connection_failed",
      };
    }
    this.logger.info({
      event: "resolver_requests_total",
      requestId,
      ...q,
      adapter: adapter.id,
      cacheHit: result.cached,
      status: result.status,
      durationMs: Date.now() - start,
      sourceHost:
        result.status === "resolved"
          ? new URL(result.source.url).hostname
          : null,
      confidence: result.status === "resolved" ? result.confidence : null,
    });
    return result;
  }
  private async uncached(
    q: BikeQuery,
    a: BikeManufacturerAdapter,
    requestId: string,
    candidateId: string | undefined,
    key: string,
  ): Promise<ResolveResult> {
    trace("discovery_started", { host: a.allowedDomains[0] });
    checkAbort();
    const candidates = (await a.discover(q)).map((c) => ({
        ...c,
        candidateId: createHash("sha256")
          .update(sourceIdentity(c.url))
          .digest("hex"),
      })),
      selection = match(q, candidates);
    trace("candidate_found", { count: selection.ranked.length });
    if (candidateId) {
      const selected = selection.ranked.find(
        (c) =>
          c.candidateId === candidateId &&
          (c.year === q.year || c.year === null) &&
          c.score >= (c.year === null ? 0.64 : EXPLICIT_MATCH_THRESHOLD),
      );
      if (!selected)
        return {
          status: "ambiguous",
          query: q,
          candidates: selection.ranked,
          cached: false,
        };
      selection.chosen = selected;
    }
    this.logger.info({
      requestId,
      adapter: a.id,
      candidateCount: candidates.length,
      chosenCandidate: selection.chosen?.url || null,
    });
    if (!selection.ranked.length) {
      const result: ResolveResult = {
        status: "not_found",
        query: q,
        brand: q.brand,
        retryable: false,
        cached: false,
      };
      await this.cache.put(key, q, result, a.id, a.adapterVersion);
      return result;
    }
    if (!selection.chosen)
      return {
        status: "ambiguous",
        query: q,
        candidates: selection.ranked,
        cached: false,
      };
    trace("candidate_selected", {
      host: new URL(selection.chosen.url).hostname,
    });
    checkAbort();
    const document = await a.fetch(selection.chosen);
    const parsed = await a.parse(document, q);
    const verified = {
      ...selection.chosen,
      canonicalName: parsed.canonicalName,
      year: parsed.year,
    };
    if (
      scoreCandidate(q, verified) <
      (candidateId
        ? parsed.year === null
          ? 0.64
          : EXPLICIT_MATCH_THRESHOLD
        : MATCH_THRESHOLD)
    )
      return {
        status: "ambiguous",
        query: q,
        candidates: [{ ...verified, score: scoreCandidate(q, verified) }],
        cached: false,
      };
    const result: ResolveResult = {
      status: "resolved",
      sourceYear: parsed.year,
      manualSelection: parsed.year === null,
      quality: parsed.quality,
      suggestedMetadata: parsed.suggestedMetadata,
      unknownFields: parsed.unknownFields,
      warnings: [
        ...(parsed.warnings || []),
        ...(parsed.year === null ? ["identity_mismatch" as const] : []),
      ],
      query: q,
      bike: {
        ...q,
        canonicalName: [
          normalize(parsed.canonicalName).startsWith(normalize(a.brand) + " ")
            ? ""
            : a.brand,
          parsed.canonicalName,
          parsed.year && !parsed.canonicalName.includes(String(parsed.year))
            ? String(parsed.year)
            : "",
        ]
          .filter(Boolean)
          .join(" "),
        manufacturerProductId:
          parsed.manufacturerProductId ||
          selection.chosen.manufacturerProductId,
        sourceUrl: document.url,
      },
      confidence: selection.chosen.score!,
      components: parsed.components,
      rawSpecification: parsed.rawSpecification,
      source: {
        manufacturer: a.brand,
        url: document.url,
        fetchedAt: document.fetchedAt,
        adapter: a.id,
        adapterVersion: a.adapterVersion,
        extractorVersion: EXTRACTOR_VERSION,
      },
      cached: false,
    };
    await this.cache.put(key, q, result, a.id, a.adapterVersion, document.hash);
    return result;
  }
}
