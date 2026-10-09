"use client";
import type * as MiniMotion from "motion/mini";
import { useEffect, useRef, useState } from "react";
import { cssBezier } from "../../lib/motion-easing.ts";
import {
  currentStage,
  outcomeText,
  recognizedCount,
  ribbonOf,
  ribbonText,
  type ProgressOutcome,
  type RibbonItem,
} from "../../lib/resolver-progress.ts";
import type { TraceEvent } from "../../lib/resolver-stream.ts";
import { Check } from "./icons.tsx";
import { loadMotion, useReducedMotion } from "./motion.tsx";

// The short status of a search under the field of step 1 (#374): a thin line,
// one phrase, the components and the last events. Every word comes from the
// events that arrived (lib/resolver-progress.ts); the only thing a timer drives
// is the decorative movement. Motion loads after the first paint: its failure
// or delay changes nothing but the movement.
type Playback = ReturnType<typeof MiniMotion.animate>;

/** One confirmed group of the finished search: found in the chosen variant or not. */
export interface ProgressCategory {
  id: string;
  name: string;
  found: boolean;
}

// A live region that does not chatter: the phrase changes with every event,
// the announcement at most every few seconds and at once when the search ends.
function useAnnouncement(text: string, delay: number) {
  const [spoken, setSpoken] = useState(text);
  const last = useRef(0);
  useEffect(() => {
    const timer = setTimeout(
      () => {
        last.current = Date.now();
        setSpoken(text);
      },
      Math.max(0, last.current + delay - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [text, delay]);
  return spoken;
}

// The segment travels along the line, one pass in a couple of seconds.
function Line({ moving }: { moving: boolean }) {
  const lane = useRef<HTMLDivElement>(null);
  const mark = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    const track = lane.current;
    const segment = mark.current;
    if (!moving || reduced || !track || !segment) return;
    let disposed = false;
    let playback: Playback | undefined;
    let observer: ResizeObserver | undefined;
    const start = ({ animate }: typeof MiniMotion) => {
      playback?.cancel();
      const width = track.clientWidth;
      if (!width) return;
      playback = animate(
        segment,
        {
          transform: [
            `translateX(${-segment.offsetWidth}px)`,
            `translateX(${width}px)`,
          ],
        },
        {
          duration: 2.4,
          repeat: Infinity,
          ease:
            cssBezier(
              getComputedStyle(track).getPropertyValue("--ease-in-out"),
            ) || "easeInOut",
        },
      );
    };
    loadMotion()
      .then((motion) => {
        if (disposed) return;
        start(motion);
        let first = true;
        observer = new ResizeObserver(() => {
          if (first) first = false;
          else if (!disposed) start(motion);
        });
        observer.observe(track);
      })
      .catch(() => {});
    return () => {
      disposed = true;
      observer?.disconnect();
      playback?.cancel();
      segment.style.transform = "";
    };
  }, [moving, reduced]);
  return (
    <div className="resolver-run-line" aria-hidden="true" ref={lane}>
      <i ref={mark} />
    </div>
  );
}

// The width of the fade at the edges of the ribbon: the track keeps this much
// after its last word (CSS), so the newest event is not faded at the tail.
const fade = 16;
const offsetOf = (element: HTMLElement) => {
  const match = /matrix\(([^)]+)\)/.exec(getComputedStyle(element).transform);
  return match ? Number(match[1].split(",")[4]) || 0 : 0;
};
// The events on one line. It stands still when it fits; when it does not, the
// view slides to the newest and then drifts slowly to the start and back; the
// pointer or the focus on it stops the drift. The text is the same for a
// reader of the screen either way.
function Ribbon({ items, moving }: { items: RibbonItem[]; moving: boolean }) {
  const view = useRef<HTMLSpanElement>(null);
  const track = useRef<HTMLSpanElement>(null);
  const words = useRef<HTMLSpanElement>(null);
  const playbacks = useRef<Playback[]>([]);
  const offset = useRef(0);
  const held = useRef(false);
  const [overflow, setOverflow] = useState(0);
  const reduced = useReducedMotion();
  const text = ribbonText(items);
  useEffect(() => {
    const outer = view.current;
    const inner = words.current;
    if (!outer || !inner) return;
    const measure = () =>
      setOverflow(
        Math.max(
          0,
          Math.ceil(inner.getBoundingClientRect().width - outer.clientWidth),
        ),
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [text]);
  useEffect(() => {
    const inner = track.current;
    if (!inner) return;
    const shift = overflow ? overflow + fade : 0;
    const tail = shift ? `translateX(${-shift}px)` : "";
    if (!overflow || !moving || reduced) {
      // Still: the newest events are the ones in view.
      inner.style.transform = tail;
      return;
    }
    let disposed = false;
    const hold = (playback: Playback) => {
      playbacks.current.push(playback);
      if (held.current) playback.pause();
      return playback;
    };
    loadMotion()
      .then(({ animate }) => {
        if (disposed) return;
        const from = offset.current;
        const loop = () =>
          hold(
            animate(
              inner,
              { transform: [tail, tail, "translateX(0px)", "translateX(0px)"] },
              {
                duration: Math.max(6, shift / 14),
                ease: "linear",
                times: [0, 0.2, 0.8, 1],
                repeat: Infinity,
                repeatType: "reverse",
              },
            ),
          );
        if (Math.abs(from + shift) < 1) return void loop();
        hold(
          animate(
            inner,
            { transform: [`translateX(${from}px)`, tail] },
            { duration: 0.45, ease: "easeOut" },
          ),
        ).then(
          () => !disposed && loop(),
          () => {},
        );
      })
      .catch(() => {
        inner.style.transform = tail;
      });
    return () => {
      disposed = true;
      offset.current = offsetOf(inner);
      for (const playback of playbacks.current) playback.cancel();
      playbacks.current = [];
    };
  }, [overflow, moving, reduced]);
  const hover = (paused: boolean) => {
    held.current = paused;
    for (const playback of playbacks.current)
      if (paused) playback.pause();
      else playback.play();
  };
  const drifting = moving && !reduced && overflow > 0;
  return (
    <span
      ref={view}
      className="resolver-run-view"
      data-overflow={overflow > 0 || undefined}
      title={overflow > 0 ? text : undefined}
      // A stop for those who cannot point: the view takes focus while it moves.
      tabIndex={drifting ? 0 : undefined}
      role={drifting ? "group" : undefined}
      aria-label={drifting ? "События поиска" : undefined}
      onPointerEnter={() => hover(true)}
      onPointerLeave={() => hover(false)}
      onFocus={() => hover(true)}
      onBlur={() => hover(false)}
    >
      <span ref={track} className="resolver-run-track">
        <span ref={words}>{items.length ? text : "пока нет"}</span>
      </span>
    </span>
  );
}

export default function ResolverProgress({
  events,
  running,
  outcome,
  categories,
  closing,
}: {
  events: TraceEvent[];
  running: boolean;
  /** How the search ended; null while it runs. */
  outcome: ProgressOutcome | null;
  /** Only for a finished search that found one variant. */
  categories?: ProgressCategory[] | null;
  /**
   * What the page says in words when the search is over (the advice what to do
   * next). This region is the one live region of the step, so the end is
   * announced here, in those words, and the page's own line is not live.
   */
  closing?: string;
}) {
  const stage = currentStage(events);
  const ribbon = ribbonOf(events);
  const recognized = recognizedCount(events);
  const phrase = running || !outcome ? stage.text : outcomeText[outcome];
  const host = running ? stage.host : undefined;
  const spoken = useAnnouncement(
    running ? phrase + (host ? ", " + host : "") : closing || phrase,
    running ? 2500 : 0,
  );
  if (!running && !outcome && !events.length) return null;
  const title = running
    ? "Ищем комплектацию"
    : outcome === "cancelled"
      ? "Поиск остановлен"
      : outcome === "failed"
        ? "Поиск прерван"
        : "Поиск завершён";
  return (
    <div
      className="resolver-run"
      data-state={running ? "running" : "done"}
      data-outcome={outcome || undefined}
      role="group"
      aria-label="Ход поиска комплектации"
    >
      <p className="resolver-run-title">{title}</p>
      <Line moving={running} />
      <p className="resolver-run-stage" aria-hidden="true">
        <span key={phrase + (host || "")} className="resolver-run-phrase">
          {phrase}
          {host && <code>{host}</code>}
          {running && stage.note && <small>{stage.note}</small>}
        </span>
      </p>
      <p className="resolver-run-components">
        <span className="resolver-run-label">Компоненты</span>
        {categories?.length ? (
          <>
            <span className="resolver-run-count">
              найдено {categories.filter((group) => group.found).length} из{" "}
              {categories.length}
            </span>
            <span
              className="resolver-run-marks"
              title={categories
                .map((group) => group.name + (group.found ? " ✓" : " —"))
                .join(", ")}
            >
              {categories.map((group) => (
                <span key={group.id} data-found={group.found || undefined}>
                  {group.name}
                  {group.found ? (
                    <Check size={12} aria-hidden="true" />
                  ) : (
                    <b aria-hidden="true">—</b>
                  )}
                  <span className="sr-only">
                    {group.found ? ": найдено" : ": не найдено"}
                  </span>
                </span>
              ))}
            </span>
          </>
        ) : recognized ? (
          <span>
            Распознано {recognized.count}
            {recognized.total !== undefined
              ? ` из ${recognized.total} характеристик`
              : ""}
          </span>
        ) : (
          <span className="resolver-run-quiet">
            {running ? "пока нет данных" : "нет данных"}
          </span>
        )}
      </p>
      <p className="resolver-run-events">
        <span className="resolver-run-label">События</span>
        <Ribbon items={ribbon} moving={running} />
      </p>
      <span className="sr-only" role="status">
        {spoken}
      </span>
    </div>
  );
}
