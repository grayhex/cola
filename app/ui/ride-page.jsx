"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { SocialHeader, SocialFooter, socialApi } from "./social-primitives.jsx";
import { RideMetrics, rideDate } from "./ride-card.jsx";
import Discussion from "./discussion.jsx";
const RideMap = dynamic(() => import("./ride-map.jsx"), { ssr: false });
export default function RidePage({ share, styleUrl }) {
  const [ride, setRide] = useState(null),
    [user, setUser] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    Promise.all([
      socialApi("me"),
      socialApi(
        "rides/" +
          (new URLSearchParams(location.search).get("owner") === "1"
            ? "owner/"
            : "public/") +
          share,
      ),
    ])
      .then(([m, d]) => {
        if (active) {
          setUser(m.user);
          setRide(d.ride);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [share]);
  return (
    <>
      <SocialHeader user={user} />
      <main className="social-page ride-page">
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {ride ? (
          <>
            <a href={"/u/" + ride.author.username}>@{ride.author.username}</a>
            <h1>{ride.title}</h1>
            <p className="help">
              {rideDate(ride.date)} ·{" "}
              <a href={"/b/" + ride.bike.shareId}>{ride.bike.name}</a>
            </p>
            <RideMetrics metrics={ride.metrics} />
            <RideMap geometry={ride.geometry} styleUrl={styleUrl} />
            {ride.description && (
              <p className="ride-description">{ride.description}</p>
            )}
            {ride.isOwner && (
              <a className="quiet" href="/account?tab=rides">
                Управлять покатушками
              </a>
            )}
            {ride.isPublic !== false && ride.bikePublic !== false && (
              <>
                <button
                  className="quiet"
                  disabled={busy || ride.isOwner}
                  aria-pressed={ride.liked}
                  onClick={async () => {
                    if (!user) {
                      location.assign("/account");
                      return;
                    }
                    setBusy(true);
                    try {
                      const d = await socialApi(
                        "rides/" + ride.id + "/like",
                        ride.liked ? "DELETE" : "PUT",
                      );
                      setRide((r) => ({ ...r, ...d }));
                    } catch (e) {
                      setError(e.message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  ♡ {ride.likes}
                </button>
                <Discussion bike={ride} user={user} entityType="ride" />
              </>
            )}
          </>
        ) : (
          !error && <p role="status">Загружаем покатушку…</p>
        )}
      </main>
      <SocialFooter />
    </>
  );
}
