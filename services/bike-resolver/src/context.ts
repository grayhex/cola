import { AsyncLocalStorage } from "node:async_hooks";
import type { SourceDocument } from "./domain.js";
export const EXTRACTOR_VERSION = 6;
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
  | "connection_failed"
  | "not_complete_bike"
  | "candidate_expired"
  | "multiple_builds";
export type EventName =
  | "retailer_search_started"
  | "resolve_started"
  | "cache_checked"
  | "cache_hit"
  | "source_planned"
  | "source_started"
  | "source_connected"
  | "discovery_started"
  | "candidate_found"
  | "candidate_selected"
  | "store_checked"
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
// What a phase did not cover: whoever cuts a list short (a page limit or the
// phase's own time) says so here, and the search report is not "complete".
export interface Notes {
  cut: boolean;
}
interface Context {
  signal: AbortSignal;
  start: number;
  // The tightest budget this work runs under, as a time; none without one.
  deadline?: number;
  notes: Notes;
  emit?: (event: TraceEvent) => void;
  documents: Map<string, Promise<SourceDocument>>;
  // Shared by every derived context: the stream is bounded as a whole.
  events: { count: number };
}
export const resolutionContext = new AsyncLocalStorage<Context>();
export function trace(
  event: EventName,
  data: Omit<Partial<TraceEvent>, "type" | "event" | "elapsedMs"> = {},
) {
  const ctx = resolutionContext.getStore();
  if (!ctx || ctx.signal.aborted || ctx.events.count++ >= 240) return;
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
    {
      signal,
      emit,
      start: Date.now(),
      notes: { cut: false },
      documents: new Map(),
      events: { count: 0 },
    },
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
// Independent work shares the request's cancellation and deadline, plus its own
// cap. `notes` collects what the work cut short, apart from other phases.
export function withinBudget<T>(
  ms: number,
  task: () => Promise<T>,
  notes?: Notes,
): Promise<T> {
  const context = resolutionContext.getStore();
  if (!context) return task();
  return resolutionContext.run(
    {
      ...context,
      deadline: Math.min(context.deadline ?? Infinity, Date.now() + ms),
      notes: notes ?? context.notes,
      signal: AbortSignal.any([context.signal, AbortSignal.timeout(ms)]),
    },
    task,
  );
}
// Time left of the tightest budget around the caller: a loop that has results
// stops asking for more when little is left, instead of losing them all.
export function budgetLeft() {
  const deadline = resolutionContext.getStore()?.deadline;
  return deadline === undefined ? Infinity : Math.max(0, deadline - Date.now());
}
export function noteCut() {
  const context = resolutionContext.getStore();
  if (context) context.notes.cut = true;
}
// Verification of many pages must not flood the progress stream.
export function quiet<T>(task: () => Promise<T>): Promise<T> {
  const context = resolutionContext.getStore();
  if (!context) return task();
  return resolutionContext.run({ ...context, emit: undefined }, task);
}
