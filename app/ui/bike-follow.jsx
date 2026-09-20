"use client";
import { useState, useEffect } from "react";
import { socialApi } from "./social-primitives.jsx";
export default function BikeFollow({ bikeId }) {
  const [following, setFollowing] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    socialApi("community/bikes/" + bikeId + "/follow")
      .then((r) => {
        if (active) setFollowing(r.following);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [bikeId]);
  return (
    <>
      <button
        className="quiet"
        disabled={busy}
        aria-pressed={following}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const r = await socialApi(
              "community/bikes/" + bikeId + "/follow",
              following ? "DELETE" : "PUT",
            );
            setFollowing(r.following);
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {following ? "Вы подписаны на велосипед" : "Подписаться на велосипед"}
      </button>
      {error && (
        <p role="alert">
          {error} <a href="/account">Войти</a>
        </p>
      )}
    </>
  );
}
