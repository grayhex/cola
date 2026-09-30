"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SharedView } from "./motion.tsx";
import RideSpeedChart from "./ride-speed-chart.jsx";
import RideMap from "./ride-map.jsx";
import RidePlanView from "./ride-plan-view.jsx";
import { Heart } from "./icons.tsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { SocialHeader, SocialFooter, socialApi } from "./social-primitives.tsx";
import { RideMetrics, rideDate } from "./ride-card.jsx";
import { useSite } from "./site-provider.tsx";
import { profilePath, publicPath } from "../../lib/public-urls.ts";
import { personName } from "../../lib/usernames.ts";
import ShareButton from "./share-button.tsx";
import LocalDate from "./local-date.tsx";
// The comment editor (Tiptap) loads after the ride itself.
const RideAnalysis = dynamic(() => import("./ride-analysis.jsx"));
// A failed chunk leaves the ride, its agreement and RSVP working (#235).
const Discussion = dynamic(
  () =>
    import("./discussion.jsx").catch(() => ({
      default: function DiscussionUnavailable() {
        return (
          <p className="help" role="status">
            Обсуждение не загрузилось. Обновите страницу, чтобы попробовать
            снова.
          </p>
        );
      },
    })),
  { ssr: false },
);
const detailPath = (share) =>
  "rides/" +
  (new URLSearchParams(location.search).get("owner") === "1"
    ? "owner/"
    : "public/") +
  share;
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
    const rideRequest = seed.current || socialApi(detailPath(share));
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
  // After an answer or an organizer action the page shows the server's state
  // (#235); permission-dependent values never outlive a failed refresh. Only
  // the latest refresh applies: answers do not wait for it, so an older one
  // that answers late would bring back the previous answer.
  const reloads = useRef(0);
  const reload = useCallback(async () => {
    const id = ++reloads.current;
    try {
      const data = await socialApi(detailPath(share));
      if (id !== reloads.current) return;
      setRide(data.ride);
      setError("");
    } catch (e) {
      if (id !== reloads.current) return;
      setRide((r) =>
        r && r.meetingVisibility === "participants" && !r.isOwner
          ? { ...r, meetingPoint: "", meetingHidden: true }
          : r,
      );
      setError(e.message);
    }
  }, [share]);
  const planned = ride?.sourceKind === "planned";
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
            {planned ? (
              <RidePlanView
                ride={ride}
                share={share}
                sharePath={sharePath}
                onReload={reload}
                onAnswer={async (next) => {
                  // A hidden meeting place closes with any answer but «Иду»
                  // at once, before the refresh confirms it (#230, #235).
                  setRide((r) =>
                    next.rsvp !== "accepted" &&
                    r.meetingVisibility === "participants" &&
                    !r.isOwner
                      ? {
                          ...r,
                          ...next,
                          meetingPoint: "",
                          meetingHidden: true,
                        }
                      : { ...r, ...next },
                  );
                  await reload();
                }}
              />
            ) : (
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
              </>
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
                          const data = await socialApi(detailPath(share));
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
            {ride.isOwner && !planned && (
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
