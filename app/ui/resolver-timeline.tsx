"use client";
import type { TraceEvent } from "../../lib/resolver-stream.ts";
import {
  failureReasons,
  significantEvents,
  traceLabels as labels,
} from "../../lib/resolver-progress.ts";
import { Check, LoaderCircle, TriangleAlert } from "./icons.tsx";

// The full technical log (the admin Resolver Inspector). The wizard shows the
// short status instead: ResolverProgress (#374).
export default function ResolverTimeline({
  events,
  running,
}: {
  events: TraceEvent[];
  running?: boolean;
}) {
  if (!events.length && !running) return null;
  const significant = significantEvents(events);
  function rows(list: TraceEvent[]) {
    return (
      <ol>
        {list.map((e, i) => (
          <li key={i}>
            {["source_failed", "conflict_found", "failed"].includes(e.event) ? (
              <TriangleAlert size={13} />
            ) : (
              <Check size={13} />
            )}
            <span>
              {labels[e.event]}
              {e.host && <small>{e.host}</small>}
              {e.strategy && <small>{e.strategy}</small>}
              {e.event === "source_failed" && e.reason && (
                <small>{failureReasons[e.reason] || e.reason}</small>
              )}
            </span>
            {e.count !== undefined && (
              <b>
                {e.count}
                {e.total !== undefined ? ` / ${e.total}` : ""}
              </b>
            )}
            <time>{(e.elapsedMs / 1000).toFixed(1)} с</time>
          </li>
        ))}
      </ol>
    );
  }
  return (
    <div className="resolver-timeline" aria-label="Ход поиска комплектации">
      {running && (
        <p role="status">
          <LoaderCircle size={14} className="resolver-spinner" />
          {labels[events.at(-1)?.event || ""] || "Подключаем парсер…"}
        </p>
      )}
      {running && rows(significant.slice(-4))}
      <details>
        <summary>Подробнее · {events.length} событий</summary>
        {rows(events)}
      </details>
    </div>
  );
}
