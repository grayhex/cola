"use client";
import { errorMessage } from "../../lib/errors.ts";
import type { RideListDto } from "./content-types.ts";
import Link from "next/link";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  startTransition,
} from "react";
import { socialApi, Pagination } from "./social-primitives.tsx";
import RideCard, { RideCompactCard, rideCardDate } from "./ride-card.tsx";
import { useSite } from "./site-provider.tsx";
import { apiFilters } from "../../lib/ride-filters.ts";
import { plural } from "../../lib/plural.ts";
import { ArrowRight } from "./icons.tsx";

// Back/forward returns to the same public list and scroll position (#233):
// only pagination and scroll are kept; personalized DTOs never enter storage.
type SavedList = { page?: number; scrollY?: number };
const storageKey = (key: string) => "cola:ride-list:v2:" + key;
function readSaved(key: string): SavedList | null {
  if (!key) return null;
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey(key)) || "null");
    return (
      value && {
        page: Number.isInteger(value.page) && value.page > 0 ? value.page : 1,
        scrollY:
          Number.isFinite(value.scrollY) && value.scrollY >= 0
            ? value.scrollY
            : 0,
      }
    );
  } catch {
    return null;
  }
}
function save(key: string, value: SavedList) {
  if (!key) return;
  try {
    sessionStorage.setItem(
      storageKey(key),
      JSON.stringify({ ...readSaved(key), ...value }),
    );
  } catch {
    // Session storage is optional; the public list still loads from the API.
  }
}
/**/
export default function RideList({
  username,
  bikeId,
  latest = false,
  status = null,
  filters = null,
  restoreKey = "",
  onReset,
  onShowAll,
  preview = false,
  compact = false,
  onTotal,
}: {
  username?: string;
  bikeId?: string;
  latest?: boolean;
  status?: string | null;
  filters?: Record<string, string> | null;
  restoreKey?: string;
  onReset?: () => void;
  // The catalogue opens on upcoming rides (#370): when none are left, a way
  // to the whole list.
  onShowAll?: () => void;
  preview?: boolean;
  // The bike page's row of small cards under a panel heading (#291).
  compact?: boolean;
  onTotal?: (total: number | null) => void;
}) {
  const { personalSettings: settings, viewer } = useSite();
  const viewerKey = viewer?.id || "guest";
  const [result, setResult] = useState<{
      viewerKey: string;
      data: RideListDto;
    } | null>(null),
    [page, setPage] = useState(1),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  const data = result?.viewerKey === viewerKey ? result.data : null;
  const [expanded, setExpanded] = useState(false);
  const seq = useRef(0),
    restoring = useRef<number | null>(null),
    query = JSON.stringify([username, bikeId, status, filters]);
  // A new filter set starts from page 1 without clearing the old result.
  const previous = useRef(query);
  useEffect(() => {
    if (previous.current !== query) {
      previous.current = query;
      setPage(1);
    }
  }, [query]);
  useLayoutEffect(() => {
    // Remove old versions that stored protected DTOs, including other filters.
    try {
      for (const key of Object.keys(sessionStorage))
        if (
          key.startsWith("cola:ride-list:") &&
          !key.startsWith("cola:ride-list:v2:")
        )
          sessionStorage.removeItem(key);
    } catch {
      /* Storage is optional. */
    }
    const saved = readSaved(restoreKey);
    if (saved) {
      restoring.current = saved.scrollY || 0;
      setPage(saved.page || 1);
    }
  }, [restoreKey]);
  useEffect(() => {
    const id = ++seq.current;
    let active = true;
    setLoading(true);
    setError("");
    socialApi<RideListDto>(
      "rides?" +
        new URLSearchParams({
          ...(username ? { username } : {}),
          ...(status ? { status } : {}),
          ...(bikeId ? { bikeId } : {}),
          ...(filters ? apiFilters(filters) : {}),
          page: String(page),
        }),
    )
      .then((d) => {
        if (!active || id !== seq.current) return; // an older filter answered late
        startTransition(() => setResult({ viewerKey, data: d }));
        save(restoreKey, { page });
      })
      .catch((e) => {
        if (active && id === seq.current) setError(errorMessage(e));
      })
      .finally(() => {
        if (active && id === seq.current) setLoading(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `query` covers the filter object
  }, [query, page, revision, restoreKey, viewerKey]);
  useEffect(() => {
    onTotal?.(error ? null : (data?.total ?? null));
  }, [data, error, onTotal]);
  // Restore the scroll only once the saved rows are laid out.
  useEffect(() => {
    if (restoring.current === null || !data) return;
    const y = restoring.current;
    restoring.current = null;
    requestAnimationFrame(() =>
      window.scrollTo({ top: y, behavior: "instant" }),
    );
  }, [data]);
  useEffect(() => {
    if (!restoreKey) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        save(restoreKey, { scrollY: window.scrollY }),
      );
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
    };
  }, [restoreKey]);
  const list =
    latest &&
    (settings.rideListMode === "list" ||
      (settings.rideListMode === "auto" && (data?.total || 0) > 5));
  // An empty rides column on a bike page shrinks to one line.
  if (latest && data?.total === 0)
    return (
      <section
        id={preview ? "bike-rides" : undefined}
        className="ride-list bike-rides bike-rides-empty"
      >
        <p className="help">Покатушек с этим велосипедом пока нет</p>
      </section>
    );
  const panel = latest && compact;
  const shown = preview && !expanded ? data?.rides.slice(0, 3) : data?.rides;
  const expandButton = (className: string) =>
    preview &&
    !expanded &&
    data &&
    data.total > 3 && (
      <button className={className} onClick={() => setExpanded(true)}>
        Все покатушки · {data.total}
        {panel && <ArrowRight size={16} aria-hidden="true" />}
      </button>
    );
  return (
    <section
      id={preview ? "bike-rides" : undefined}
      className={
        "ride-list" +
        (latest ? " bike-rides" : "") +
        (panel ? " bike-panel" : "")
      }
      aria-labelledby={panel ? "bike-rides-title" : undefined}
    >
      {panel ? (
        <div className="panel-heading">
          <h2 id="bike-rides-title">Последние покатушки</h2>
          {expandButton("text-link")}
        </div>
      ) : (
        <h2>Покатушки</h2>
      )}
      {error && (
        <p role="alert" className="error">
          {error}{" "}
          <button className="quiet" onClick={() => setRevision((v) => v + 1)}>
            Повторить
          </button>
        </p>
      )}
      {data ? (
        <>
          <p className={panel ? "visually-hidden" : "help"} aria-live="polite">
            {data.total}{" "}
            {plural(data.total, "покатушка", "покатушки", "покатушек")}
            {status !== "planned" &&
              ` · ${(data.totalDistanceM / 1000).toLocaleString("ru-RU", {
                maximumFractionDigits: 1,
              })} км`}
            {loading && " · обновляем…"}
          </p>
          {/* No MotionList here: a list view transition with the cards' nested
              SharedView names held React commits, so quick filter changes
              stalled (#233). Stale answers are still dropped by sequence. */}
          <div
            className={
              list
                ? "ride-accordion"
                : panel
                  ? "ride-compact-grid"
                  : "ride-grid"
            }
            aria-busy={loading}
          >
            {shown?.map((r) =>
              list ? (
                <details className="ride-list-item" key={r.id}>
                  <summary>
                    <strong>{r.title}</strong>
                    <small>
                      {rideCardDate(r)} ·{" "}
                      {(Number(r.metrics.distanceM) / 1000).toLocaleString(
                        "ru-RU",
                        {
                          maximumFractionDigits: 1,
                        },
                      )}{" "}
                      км
                    </small>
                  </summary>
                  <RideCard ride={r} />
                </details>
              ) : panel ? (
                <RideCompactCard key={r.id} ride={r} />
              ) : (
                <RideCard key={r.id} ride={r} />
              ),
            )}
          </div>
          {!data.total && !error && status === "planned" && (
            <div className="empty-state">
              <p>
                {onReset
                  ? "По этим фильтрам предстоящих выездов нет."
                  : "Предстоящих публичных выездов пока нет."}
              </p>
              <div className="page-actions">
                {onReset && (
                  <button className="button secondary small" onClick={onReset}>
                    Сбросить фильтры
                  </button>
                )}
                {onShowAll && !onReset && (
                  <button
                    type="button"
                    className="button secondary small"
                    onClick={onShowAll}
                  >
                    Показать все покатушки
                  </button>
                )}
                <Link className="button secondary small" href="/ride-intents">
                  Отметить, когда хочу кататься
                </Link>
              </div>
            </div>
          )}
          {preview && !expanded ? (
            !panel && expandButton("quiet")
          ) : (
            <Pagination {...data} onPage={setPage} />
          )}
        </>
      ) : (
        !error && <p role="status">Загружаем покатушки…</p>
      )}
    </section>
  );
}
