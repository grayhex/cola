"use client";
import { useState, useEffect, useRef } from "react";
import { socialApi } from "./social-primitives.jsx";
export default function BikeFollow({ bikeId }) {
  const [following, setFollowing] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    // A status that arrives after the reader's click must not undo it.
    touched = useRef(false);
  useEffect(() => {
    let active = true;
    touched.current = false;
    socialApi("community/bikes/" + bikeId + "/follow")
      .then((r) => {
        if (active && !touched.current) setFollowing(r.following);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [bikeId]);
  return (
    <>
      <button
        className={"button small " + (following ? "" : "secondary")}
        disabled={busy}
        aria-pressed={following}
        onClick={async () => {
          touched.current = true;
          setBusy(true);
          setError("");
          const before = following;
          setFollowing(!before);
          try {
            const r = await socialApi(
              "community/bikes/" + bikeId + "/follow",
              before ? "DELETE" : "PUT",
              undefined,
              { keepalive: true },
            );
            setFollowing(r.following);
          } catch (e) {
            setFollowing(before);
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {following ? "Вы подписаны" : "Подписаться"}
        <span className="sr-only"> на велосипед</span>
      </button>
      {error && (
        <p role="alert">
          {error} <a href="/account">Войти</a>
        </p>
      )}
    </>
  );
}
