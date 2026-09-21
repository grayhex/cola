"use client";
import { useEffect, useState } from "react";
import { socialApi, Pagination } from "./social-primitives.jsx";
import RideCard, { rideDate } from "./ride-card.jsx";
import { useSite } from "./site-provider.jsx";
export default function RideList({
  username,
  bikeId,
  latest = false,
  status = null,
}) {
  const { personalSettings: settings } = useSite();
  const [data, setData] = useState(null),
    [page, setPage] = useState(1),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    socialApi(
      "rides?" +
        new URLSearchParams({
          ...(username ? { username } : {}),
          ...(status ? { status } : {}),
          ...(bikeId ? { bikeId } : {}),
          page,
        }),
    )
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [username, bikeId, page, status]);
  const list =
    latest &&
    (settings.rideListMode === "list" ||
      (settings.rideListMode === "auto" && data?.total > 5));
  return (
    <section className={"ride-list" + (latest ? " bike-rides" : "")}>
      <h2>Покатушки</h2>
      {error && <p role="alert">{error}</p>}
      {data ? (
        <>
          <p className="help">
            {data.total} покатушек ·{" "}
            {(data.totalDistanceM / 1000).toLocaleString("ru-RU", {
              maximumFractionDigits: 1,
            })}{" "}
            км
          </p>
          <div className={list ? "ride-accordion" : "ride-grid"}>
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
          <Pagination {...data} onPage={setPage} />
        </>
      ) : (
        !error && <p role="status">Загружаем покатушки…</p>
      )}
    </section>
  );
}
