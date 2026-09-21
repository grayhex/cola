"use client";
import RideSpeedChart from "./ride-speed-chart.jsx";
import { Heart } from "./icons.jsx";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { SocialHeader, SocialFooter, socialApi } from "./social-primitives.jsx";
import { RideMetrics, rideDate } from "./ride-card.jsx";
import { useSite } from "./site-provider.jsx";
import Discussion from "./discussion.jsx";
const RideMap = dynamic(() => import("./ride-map.jsx"), {
  ssr: false,
  loading: () => <div className="ride-map-wrap" aria-busy="true" />,
});
export default function RidePage({ share, styleUrl }) {
  const { setPreferences } = useSite();
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
          setPreferences(m.user?.preferences || {});
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
            {ride.status !== "completed" && (
              <p className="ride-status">
                {ride.status === "cancelled"
                  ? "Покатушка отменена"
                  : "Планируемая покатушка"}{" "}
                · {new Date(ride.scheduledAt).toLocaleString("ru-RU")}
              </p>
            )}
            {ride.meetingPoint && <p>Место встречи: {ride.meetingPoint}</p>}
            {ride.features?.length > 0 && (
              <ul className="ride-features">
                {ride.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            )}
            <RideMetrics
              metrics={ride.metrics}
              visibleMetrics={ride.visibleMetrics}
            />
            {!ride.hasTrack && (
              <p className="help">
                Трек пока не добавлен
                {ride.sourceKind === "garmin" ? " · импорт Garmin" : ""}.
              </p>
            )}
            {ride.invitation && ride.status === "planned" && (
              <section className="ride-invitation">
                <h2>Вы приглашены</h2>
                <p>
                  {
                    {
                      pending: "Ответьте на приглашение организатора.",
                      accepted: "Вы участвуете в покатушке.",
                      declined: "Вы отклонили приглашение.",
                    }[ride.invitation]
                  }
                </p>
                {["accepted", "declined"].map((response) => (
                  <button
                    key={response}
                    className="quiet"
                    disabled={busy || ride.invitation === response}
                    onClick={async () => {
                      setBusy(true);
                      setError("");
                      try {
                        await socialApi(
                          "rides/" + ride.id + "/invitation",
                          "PATCH",
                          { response },
                        );
                        setRide((r) => ({ ...r, invitation: response }));
                      } catch (e) {
                        setError(e.message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {response === "accepted" ? "Поеду" : "Не смогу"}
                  </button>
                ))}
              </section>
            )}
            {ride.isOwner && ride.invitations?.length > 0 && (
              <section className="ride-invitation">
                <h2>Приглашённые</h2>
                {ride.invitations.map((i) => (
                  <p key={i.username}>
                    @{i.username} ·{" "}
                    {
                      {
                        pending: "ожидает ответа",
                        accepted: "поедет",
                        declined: "не сможет",
                      }[i.response]
                    }
                  </p>
                ))}
              </section>
            )}
            {ride.geometry.length > 0 && (
              <RideMap geometry={ride.geometry} styleUrl={styleUrl} />
            )}
            {ride.hasTrack && ride.status === "completed" && (
              <RideSpeedChart profile={ride.speedProfile} />
            )}
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
                  <Heart size={14} /> {ride.likes}
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
