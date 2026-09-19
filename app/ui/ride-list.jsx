"use client";
import { useEffect, useState } from "react";
import { socialApi, Pagination } from "./social-primitives.jsx";
import RideCard from "./ride-card.jsx";
export default function RideList({ username, bikeId, latest = false }) {
  const [data, setData] = useState(null),
    [page, setPage] = useState(1),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    socialApi(
      "rides?" +
        new URLSearchParams({
          ...(username ? { username } : {}),
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
  }, [username, bikeId, page]);
  return (
    <section className="ride-list">
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
          <div className="ride-grid">
            {(latest ? data.rides.slice(0, 3) : data.rides).map((r) => (
              <RideCard key={r.id} ride={r} />
            ))}
          </div>
          {latest && data.total > 3 ? (
            <a href={"/rides?bikeId=" + bikeId}>
              Все покатушки на этом велосипеде
            </a>
          ) : (
            !latest && <Pagination {...data} onPage={setPage} />
          )}
        </>
      ) : (
        !error && <p role="status">Загружаем покатушки…</p>
      )}
    </section>
  );
}
