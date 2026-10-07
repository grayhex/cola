import type {
  BikeQuery,
  ResolveResult,
  SourceKind,
  SourceReport,
} from "./domain.js";
import { checkAbort, trace, type Reason } from "./context.js";
const priority: Record<SourceKind, number> = {
  manufacturer: 0,
  distributor: 0,
  archive: 1,
  manual: 2,
  store: 3,
  web: 4,
};
// What a failed phase tells the person: a reachable-but-unreadable source says
// more than a plain miss, a miss more than "nobody serves this brand".
const informative: Record<ResolveResult["status"], number> = {
  resolved: 6,
  ambiguous: 5,
  upstream_unavailable: 4,
  parse_error: 3,
  not_found: 2,
  unsupported_brand: 1,
};
export interface SourceProvider {
  id: string;
  kind: SourceKind;
  resolve: () => Promise<ResolveResult>;
}
// Providers are phases (official, user URL, stores...), tried in priority order;
// a phase may fan out over many sources itself, so there is no cutoff here.
// Providers own discovery/matching. Planner never merges unrelated model specs.
export class SourcePlanner {
  async resolve(
    query: BikeQuery,
    providers: SourceProvider[],
  ): Promise<ResolveResult> {
    const sources = [...providers].sort(
      (a, b) => priority[a.kind] - priority[b.kind],
    );
    trace("source_planned", { count: sources.length });
    let last: ResolveResult = {
      status: "unsupported_brand",
      brand: query.brand,
      query,
      cached: false,
      retryable: false,
    };
    for (const [index, source] of sources.entries()) {
      checkAbort();
      if (index) trace("fallback_started");
      trace("source_started");
      const current = await source.resolve();
      checkAbort();
      if (informative[current.status] >= informative[last.status])
        last = current;
      if (current.status === "resolved") return current;
      // Ambiguity needs user input, not a guess from a lower-quality source.
      if (
        current.status === "ambiguous" &&
        !sources.slice(index + 1).some((p) => p.kind === "manual")
      )
        return current;
      trace("source_failed", {
        reason:
          ("reason" in current ? current.reason : undefined) ||
          "spec_fields_not_found",
      });
    }
    return last;
  }
}
export class Diagnostics {
  private sources = new Map<
    string,
    {
      lastSuccess?: string;
      lastFailure?: string;
      reason?: Reason;
      durationMs: number;
    }
  >();
  record(id: string, result: ResolveResult, durationMs: number) {
    const prior = this.sources.get(id) || { durationMs: 0 };
    this.sources.set(id, {
      ...prior,
      durationMs,
      ...(result.status === "resolved"
        ? { lastSuccess: new Date().toISOString() }
        : {
            lastFailure: new Date().toISOString(),
            reason:
              ("reason" in result ? result.reason : undefined) ||
              "spec_fields_not_found",
          }),
    });
  }
  // One line per source of a search: what worked, what was refused and why.
  recordSource(report: SourceReport) {
    const prior = this.sources.get(report.id) || { durationMs: 0 };
    const failed = ["blocked", "timeout", "unavailable"].includes(
      report.status,
    );
    this.sources.set(report.id, {
      ...prior,
      durationMs: report.durationMs,
      ...(report.status === "ok"
        ? { lastSuccess: new Date().toISOString() }
        : failed
          ? {
              lastFailure: new Date().toISOString(),
              reason: report.reason || "connection_failed",
            }
          : {}),
    });
  }
  snapshot() {
    return Object.fromEntries(this.sources);
  }
}
