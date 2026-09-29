"use client";
import Link from "next/link";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  startTransition,
} from "react";
import { socialApi, Pagination } from "./social-primitives.jsx";
import RideCard, { rideDate } from "./ride-card.jsx";
import { MotionList } from "./motion.jsx";
import { useSite } from "./site-provider.jsx";
import { apiFilters } from "../../lib/ride-filters.js";
import { plural } from "../../lib/plural.js";

// Back/forward returns to the same public list and scroll position (#233):
// the last public page is kept per filter set in this tab only.
const storageKey = (key) => "cola:ride-list:" + key;
function readSaved(key) {
  if (!key) return null;
  try {
    return JSON.parse(sessionStorage.getItem(storageKey(key)) || "null");
  } catch {
    return null;
  }
}
function save(key, value) {
  if (!key) return;
  try {
    sessionStorage.setItem(
      storageKey(key),
      JSON.stringify({ ...readSaved(key), ...value }),
    );
  } catch {}
}
export default function RideList({
  username,
  bikeId,
  latest = false,
  status = null,
  filters = null,
  restoreKey = "",
  onReset,
}) {
  const { personalSettings: settings } = useSite();
  const [data, setData] = useState(null),
    [page, setPage] = useState(1),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  const seq = useRef(0),
    restoring = useRef(null),
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
    const saved = readSaved(restoreKey);
    if (saved?.data) {
      restoring.current = saved.scrollY || 0;
      setData(saved.data);
      setPage(saved.page || 1);
    }
  }, [restoreKey]);
  useEffect(() => {
    const id = ++seq.current;
    setLoading(true);
    setError("");
    socialApi(
      "rides?" +
        new URLSearchParams({
          ...(username ? { username } : {}),
          ...(status ? { status } : {}),
          ...(bikeId ? { bikeId } : {}),
          ...(filters ? apiFilters(filters) : {}),
          page,
        }),
    )
      .then((d) => {
        if (id !== seq.current) return; // an older filter answered late
        startTransition(() => setData(d));
        save(restoreKey, { data: d, page });
      })
      .catch((e) => {
        if (id === seq.current) setError(e.message);
      })
      .finally(() => {
        if (id === seq.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `query` covers the filter object
  }, [query, page, revision, restoreKey]);
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
      (settings.rideListMode === "auto" && data?.total > 5));
  // An empty rides column on a bike page shrinks to one line.
  if (latest && data?.total === 0)
    return (
      <section className="ride-list bike-rides bike-rides-empty">
        <p className="help">Покатушек с этим велосипедом пока нет</p>
      </section>
    );
  return (
    <section className={"ride-list" + (latest ? " bike-rides" : "")}>
      <h2>Покатушки</h2>
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
          <p className="help" aria-live="polite">
            {data.total}{" "}
            {plural(data.total, "покатушка", "покатушки", "покатушек")}
            {status !== "planned" &&
              ` · ${(data.totalDistanceM / 1000).toLocaleString("ru-RU", {
                maximumFractionDigits: 1,
              })} км`}
            {loading && " · обновляем…"}
          </p>
          <MotionList>
            <div
              className={list ? "ride-accordion" : "ride-grid"}
              aria-busy={loading}
            >
              {data.rides.map((r) =>
                list ? (
                  <details className="ride-list-item" key={r.id}>
                    <summary>
                      <strong>{r.title}</strong>
                      <small>
                        {rideDate(r.date)} ·{" "}
                        {(r.metrics.distanceM / 1000).toLocaleString("ru-RU", {
                          maximumFractionDigits: 1,
                        })}{" "}
                        км
                      </small>
                    </summary>
                    <RideCard ride={r} />
                  </details>
                ) : (
                  <RideCard key={r.id} ride={r} />
                ),
              )}
            </div>
          </MotionList>
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
                <Link className="button secondary small" href="/ride-intents">
                  Отметить, когда хочу кататься
                </Link>
              </div>
            </div>
          )}
          <Pagination {...data} onPage={setPage} />
        </>
      ) : (
        !error && <p role="status">Загружаем покатушки…</p>
      )}
    </section>
  );
}
