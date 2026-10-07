import type { infer as inferType } from "zod";
import type { resolverQuery as resolverQueryType } from "./bike-resolver-client.ts";
import type { ResolveResult } from "./bike-resolver-client.ts";
export interface TraceEvent {
  type: "event";
  event: string;
  elapsedMs: number;
  count?: number;
  total?: number;
  host?: string;
  strategy?: string;
  reason?: string;
}
// Shared bounded NDJSON decoder. No framework dependencies: used on server and browser.
export const resolverEvents = new Set(
  "retailer_search_started resolve_started cache_checked cache_hit source_planned source_started source_connected discovery_started candidate_found candidate_selected store_checked document_fetch_started document_fetched structured_data_found spec_section_found extractor_started fields_extracted normalization_started components_recognized source_failed fallback_started conflict_found resolved partial failed completed".split(
    " ",
  ),
);
export function safeTrace(input: unknown) {
  const value =
    input !== null && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  if (
    value?.type !== "event" ||
    !(typeof value.event === "string" && resolverEvents.has(value.event))
  )
    return null;
  const out: TraceEvent = {
    type: "event",
    event: value.event,
    elapsedMs: Math.max(0, Math.min(Number(value.elapsedMs) || 0, 120000)),
  };
  for (const key of ["count", "total"] as const) {
    const count = value[key];
    if (
      typeof count === "number" &&
      Number.isInteger(count) &&
      count >= 0 &&
      count <= 30000
    )
      out[key] = count;
  }
  if (
    typeof value.host === "string" &&
    /^(?=.{1,253}$)[a-z0-9.-]+\.[a-z]{2,}$/i.test(value.host)
  )
    out.host = value.host;
  if (
    typeof value.strategy === "string" &&
    /^[a-z-]{1,40}$/.test(value.strategy)
  )
    out.strategy = value.strategy;
  const reasons = new Set(
    "dns_failed timeout http_403 http_404 http_429 http_error access_challenge unsupported_charset body_too_large js_shell spec_section_not_found spec_fields_not_found labels_unrecognized identity_mismatch conflicting_sources selector_profile_failed blocked_source aborted connection_failed not_complete_bike candidate_expired multiple_builds".split(
      " ",
    ),
  );
  if (typeof value.reason === "string" && reasons.has(value.reason))
    out.reason = value.reason;
  return out;
}
export async function* readResolverStream(
  body: ReadableStream<Uint8Array<ArrayBuffer>> | null,
) {
  if (!body) throw new Error("Empty resolver stream");
  const reader = body.getReader(),
    decoder = new TextDecoder();
  let pending = "",
    bytes = 0,
    lines = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 4 * 1024 * 1024)
        throw new Error("Resolver response too large");
      pending += decoder.decode(value, { stream: true });
      let end;
      while ((end = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 1);
        if (!line.trim()) continue;
        if (++lines > 242) throw new Error("Too many resolver events");
        yield JSON.parse(line) as Record<string, unknown>;
      }
    }
    if (pending.trim()) throw new Error("Incomplete resolver stream");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export async function resolveWithTrace(
  input: inferType<typeof resolverQueryType>,
  signal: AbortSignal,
  onEvent: (event: TraceEvent) => void,
  endpoint = "/api/bikes/resolve-stream",
): Promise<ResolveResult & { previewId?: string }> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  if (!response.ok) throw new Error("Не удалось выполнить поиск");
  for await (const value of readResolverStream(response.body)) {
    // The app's resolve endpoint validates the service result before streaming
    // it. Keep that JSON boundary typed without changing bounded NDJSON parsing.
    if (value.type === "result")
      return value.result as ResolveResult & { previewId?: string };
    const event = safeTrace(value);
    if (event) onEvent(event);
  }
  throw new Error("Поиск прерван до получения результата");
}
