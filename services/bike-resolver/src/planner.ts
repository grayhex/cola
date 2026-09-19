import type { BikeQuery, ResolveResult } from "./domain.js";
import { checkAbort, trace, type Reason } from "./context.js";
export type SourceKind =
  "manufacturer" | "archive" | "manual" | "retailer" | "generic";
const priority: Record<SourceKind, number> = {
  manufacturer: 0,
  archive: 1,
  manual: 2,
  retailer: 3,
  generic: 4,
};
export interface SourceProvider {
  id: string;
  kind: SourceKind;
  resolve: () => Promise<ResolveResult>;
}
export const MAX_SOURCES = 3;
// Providers own discovery/matching. Planner never merges unrelated model specs.
export class SourcePlanner {
  async resolve(
    query: BikeQuery,
    providers: SourceProvider[],
  ): Promise<ResolveResult> {
    const sources = [...providers]
      .sort((a, b) => priority[a.kind] - priority[b.kind])
      .slice(0, MAX_SOURCES);
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
      last = await source.resolve();
      checkAbort();
      if (last.status === "resolved") return last;
      // Ambiguity needs user input, not a guess from a lower-quality source.
      if (
        last.status === "ambiguous" &&
        !sources.slice(index + 1).some((p) => p.kind === "manual")
      )
        return last;
      trace("source_failed", {
        reason:
          ("reason" in last ? last.reason : undefined) ||
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
  snapshot() {
    return Object.fromEntries(this.sources);
  }
}
