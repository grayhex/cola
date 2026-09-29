"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import RidePassport from "./ride-passport.jsx";
import { SharedView } from "./motion.jsx";
import RideRsvp, { RecurringRideLabel } from "./ride-rsvp.jsx";
import RideSpeedChart from "./ride-speed-chart.jsx";
import RideMap from "./ride-map.jsx";
import { Heart } from "./icons.jsx";
import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { SocialHeader, SocialFooter, socialApi } from "./social-primitives.jsx";
import { RideMetrics, rideDate } from "./ride-card.jsx";
import { useSite } from "./site-provider.jsx";
import { profilePath, publicPath } from "../../lib/public-urls.js";
import { personName } from "../../lib/usernames.js";
import ShareButton from "./share-button.jsx";
import LocalDate from "./local-date.jsx";
// The comment editor (Tiptap) loads after the ride itself.
const RideAnalysis = dynamic(() => import("./ride-analysis.jsx"));
const Discussion = dynamic(() => import("./discussion.jsx"), { ssr: false });
export default function RidePage({
  share,
  styleUrl,
  sharePath = null,
  initial = null,
}) {
  const router = useRouter();
  const { viewer: user } = useSite();
  const [ride, setRide] = useState(initial?.ride || null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [analysisBusy, setAnalysisBusy] = useState(false),
    [selected, setSelected] = useState(0);
  const analysisPoints = useMemo(
    () => ride?.analysis?.segments.flat() || [],
    [ride?.analysis],
  );
  const geometry = useMemo(
    () =>
      ride?.analysis?.visibility === "owner"
        ? ride.analysis.segments.map((run) => run.map((p) => p.coord))
        : ride?.geometry || [],
    [ride],
  );
  // The server rendered the public ride for this viewer (#74).
  const seed = useRef(initial);
  useEffect(() => {
    let active = true;
    const rideRequest =
      seed.current ||
      socialApi(
        "rides/" +
          (new URLSearchParams(location.search).get("owner") === "1"
            ? "owner/"
            : "public/") +
          share,
      );
    seed.current = null;
    Promise.resolve(rideRequest)
      .then((d) => {
        if (active) setRide(d.ride);
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
      <main className="page ride-page">
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {ride ? (
          <>
            <div className="entity-byline">
              <a href={profilePath(ride.author.username)}>
                {personName(ride.author)}
              </a>
              <ShareButton path={sharePath} title={ride.title} />
            </div>
            <SharedView kind="ride-title" id={ride.id}>
              <h1>{ride.title}</h1>
            </SharedView>
            <p className="help">
              {rideDate(ride.date)} ·{" "}
              <a href={publicPath("bike", ride.bike)}>{ride.bike.name}</a>
            </p>
            {ride.status !== "completed" && (
              <p className="ride-status">
                {ride.status === "cancelled"
                  ? "Покатушка отменена"
                  : "Планируемая покатушка"}{" "}
                · <LocalDate value={ride.scheduledAt} time />
              </p>
            )}
            {ride.sourceKind === "planned" && (
              <RidePassport passport={ride.passport} />
            )}
            {ride.expectedEndAt && (
              <p className="help">
                Ожидаемое окончание:{" "}
                <LocalDate value={ride.expectedEndAt} time />
              </p>
            )}
            {ride.meetingHidden && (
              <p className="help" role="status">
                Точное место встречи доступно после ответа «Иду».
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
            <RecurringRideLabel ride={ride} />
            {ride.invitation && (
              <p className="help">Вы приглашены организатором.</p>
            )}
            <RideRsvp
              ride={ride}
              onResponse={async (next) => {
                // Remove the previous permission-dependent value immediately, even if the refresh fails.
                setRide((r) =>
                  r.meetingVisibility === "participants" && !r.isOwner
                    ? { ...r, ...next, meetingPoint: "", meetingHidden: true }
                    : { ...r, ...next },
                );
                try {
                  const data = await socialApi(
                    "rides/" + (ride.isOwner ? "owner/" : "public/") + share,
                  );
                  setRide(data.ride);
                } catch (e) {
                  setError(e.message);
                }
              }}
            />
            {ride.isOwner && ride.invitations?.length > 0 && (
              <section className="ride-invitation">
                <h2>Приглашённые</h2>
                {ride.invitations.map((i) => (
                  <p key={i.username}>
                    {personName(i)} ·{" "}
                    {
                      {
                        pending: "ожидает ответа",
                        accepted: "поедет",
                        declined: "не сможет",
                        maybe: "возможно",
                      }[i.response]
                    }
                  </p>
                ))}
              </section>
            )}
            {geometry.length > 0 && (
              <RideMap
                geometry={geometry}
                selectedCoord={
                  analysisPoints[Math.min(selected, analysisPoints.length - 1)]
                    ?.coord
                }
                styleUrl={styleUrl}
                transitionId={ride.id}
              />
            )}
            {ride.hasTrack &&
              ride.status === "completed" &&
              (ride.analysis ? (
                <RideAnalysis
                  key={ride.id}
                  series={ride.analysis}
                  selected={selected}
                  onSelect={setSelected}
                />
              ) : (
                <>
                  <RideSpeedChart profile={ride.speedProfile} />
                  {ride.isOwner && (
                    <button
                      className="quiet"
                      disabled={analysisBusy}
                      onClick={async () => {
                        setAnalysisBusy(true);
                        setError("");
                        try {
                          await socialApi(
                            "rides/" + ride.id + "/analysis",
                            "POST",
                          );
                          const mode =
                            new URLSearchParams(location.search).get(
                              "owner",
                            ) === "1"
                              ? "owner/"
                              : "public/";
                          const data = await socialApi("rides/" + mode + share);
                          setRide(data.ride);
                          setSelected(0);
                        } catch (e) {
                          setError(e.message);
                        } finally {
                          setAnalysisBusy(false);
                        }
                      }}
                    >
                      {analysisBusy
                        ? "Готовим анализ…"
                        : "Подготовить анализ трека"}
                    </button>
                  )}
                </>
              ))}
            {ride.description && (
              <p className="ride-description">{ride.description}</p>
            )}
            {ride.isOwner && (
              <Link className="quiet" href="/account?tab=rides">
                Управлять покатушками
              </Link>
            )}
            {ride.isPublic !== false && ride.bikePublic !== false && (
              <>
                <button
                  className="quiet"
                  data-hover="like"
                  disabled={busy || ride.isOwner}
                  aria-pressed={ride.liked}
                  onClick={async () => {
                    if (!user) {
                      router.push("/account");
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
