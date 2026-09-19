import { AsyncLocalStorage } from "node:async_hooks";
import type { SourceDocument } from "./domain.js";
export const EXTRACTOR_VERSION = 2;
export const RESULT_SCHEMA_VERSION = 2;
export type Reason =
  | "dns_failed"
  | "timeout"
  | "http_403"
  | "http_404"
  | "http_429"
  | "http_error"
  | "access_challenge"
  | "unsupported_charset"
  | "body_too_large"
  | "js_shell"
  | "spec_section_not_found"
  | "spec_fields_not_found"
  | "labels_unrecognized"
  | "identity_mismatch"
  | "conflicting_sources"
  | "selector_profile_failed"
  | "blocked_source"
  | "aborted"
  | "connection_failed";
export type EventName =
  | "resolve_started"
  | "cache_checked"
  | "cache_hit"
  | "source_planned"
  | "source_started"
  | "source_connected"
  | "discovery_started"
  | "candidate_found"
  | "candidate_selected"
  | "document_fetch_started"
  | "document_fetched"
  | "structured_data_found"
  | "spec_section_found"
  | "extractor_started"
  | "fields_extracted"
  | "normalization_started"
  | "components_recognized"
  | "source_failed"
  | "fallback_started"
  | "conflict_found"
  | "resolved"
  | "partial"
  | "failed"
  | "completed";
export interface TraceEvent {
  type: "event";
  event: EventName;
  elapsedMs: number;
  host?: string;
  strategy?: string;
  count?: number;
  total?: number;
  reason?: Reason;
}
interface Context {
  signal: AbortSignal;
  start: number;
  emit?: (event: TraceEvent) => void;
  documents: Map<string, Promise<SourceDocument>>;
  events: number;
}
export const resolutionContext = new AsyncLocalStorage<Context>();
export function trace(
  event: EventName,
  data: Omit<Partial<TraceEvent>, "type" | "event" | "elapsedMs"> = {},
) {
  const ctx = resolutionContext.getStore();
  if (!ctx || ctx.signal.aborted || ctx.events++ >= 240) return;
  // Deliberate fields only; never exception text, headers, query URLs or HTML.
  ctx.emit?.({
    type: "event",
    event,
    elapsedMs: Date.now() - ctx.start,
    ...data,
  });
}
export const checkAbort = () =>
  resolutionContext.getStore()?.signal.throwIfAborted();
export function withResolution<T>(
  signal: AbortSignal,
  emit: Context["emit"],
  work: () => Promise<T>,
): Promise<T> {
  return resolutionContext.run(
    { signal, emit, start: Date.now(), documents: new Map(), events: 0 },
    work,
  );
}
export async function abortable<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const stop = () => reject(signal.reason);
    signal.addEventListener("abort", stop, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", stop));
  });
}
