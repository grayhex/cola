"use client";
import { errorMessage } from "../../lib/errors.ts";
import Link from "next/link";
import { useState, useEffect, useRef } from "react";
import { socialApi } from "./social-primitives.tsx";
import { Bell, BellRing } from "./icons.tsx";
// A short label in the bike's action row (#121); the accessible name keeps
// the whole phrase.
export default function BikeFollow({
  bikeId,
  className = "quiet",
}: {
  bikeId: string;
  className?: string;
}) {
  const [following, setFollowing] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    // A status that arrives after the reader's click must not undo it.
    touched = useRef(false);
  useEffect(() => {
    let active = true;
    touched.current = false;
    socialApi<{ following: boolean }>("community/bikes/" + bikeId + "/follow")
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
        type="button"
        className={className}
        data-hover="follow"
        disabled={busy}
        aria-pressed={following}
        aria-label={
          following ? "Вы подписаны на велосипед" : "Подписаться на велосипед"
        }
        onClick={async () => {
          touched.current = true;
          setBusy(true);
          setError("");
          const before = following;
          setFollowing(!before);
          try {
            const r = await socialApi<{ following: boolean }>(
              "community/bikes/" + bikeId + "/follow",
              before ? "DELETE" : "PUT",
              undefined,
              { keepalive: true },
            );
            setFollowing(r.following);
          } catch (e) {
            setFollowing(before);
            setError(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {following ? (
          <BellRing size={15} aria-hidden="true" />
        ) : (
          <Bell size={15} aria-hidden="true" />
        )}
        <span>{following ? "Вы подписаны" : "Подписаться"}</span>
      </button>
      {error && (
        <p role="alert" data-follow-error>
          {error} <Link href="/account">Войти</Link>
        </p>
      )}
    </>
  );
}
