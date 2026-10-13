"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { ClubDto } from "../../lib/club-contracts.ts";
import type { clubNoticePreferences } from "../../lib/club-events.ts";
import type { nearestClubRide } from "../../lib/club-nearest.ts";
import { useSite } from "./site-provider.tsx";
import { socialApi } from "./social-primitives.tsx";
import styles from "./clubs.module.css";
type Preferences = Awaited<ReturnType<typeof clubNoticePreferences>>;
type Nearest = Awaited<ReturnType<typeof nearestClubRide>>;
export default function ClubNoticeControls({ club }: { club: ClubDto }) {
  const { viewer } = useSite();
  return (
    <Contents
      key={
        club.id +
        ":" +
        club.version +
        ":" +
        (viewer?.id || "guest") +
        ":" +
        club.membership?.state
      }
      club={club}
    />
  );
}
function Contents({ club }: { club: ClubDto }) {
  const { viewer } = useSite(),
    [prefs, setPrefs] = useState<Preferences | null>(null),
    [nearest, setNearest] = useState<Nearest | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const member =
    viewer &&
    club.membership?.userId === viewer.id &&
    club.membership.state === "active" &&
    !club.hidden;
  useEffect(() => {
    let active = true;
    socialApi<Nearest>("clubs/" + club.id + "/nearest")
      .then((d) => {
        if (active) setNearest(d);
      })
      .catch(() => {});
    if (member)
      socialApi<Preferences>("clubs/" + club.id + "/notice-preferences")
        .then((d) => {
          if (active) setPrefs(d);
        })
        .catch((e) => {
          if (active)
            setError(
              e instanceof Error
                ? e.message
                : "Не удалось загрузить настройки уведомлений",
            );
        });
    return () => {
      active = false;
    };
  }, [club.id, member]);
  return (
    <>
      {nearest?.viewerId === (viewer?.id || null) && nearest.ride && (
        <p className={styles.nearest}>
          <span className="help">Ближайший выезд</span>
          <br />
          <Link href={nearest.ride.href}>{nearest.ride.title}</Link>
          <br />
          <time dateTime={nearest.ride.at}>
            {new Date(nearest.ride.at).toLocaleString("ru-RU", {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </time>
        </p>
      )}
      {member && prefs?.viewerId === viewer?.id && (
        <label className={styles.noticePreference}>
          <input
            type="checkbox"
            checked={prefs.notifyRides}
            disabled={busy || (!prefs.verified && !prefs.notifyRides)}
            onChange={async (e) => {
              const notifyRides = e.target.checked,
                previous = prefs;
              setPrefs({ ...prefs, notifyRides });
              setBusy(true);
              setError("");
              try {
                setPrefs(
                  await socialApi<Preferences>(
                    "clubs/" + club.id + "/notice-preferences",
                    "PATCH",
                    { notifyRides },
                  ),
                );
              } catch (e) {
                setPrefs(previous);
                setError(
                  e instanceof Error
                    ? e.message
                    : "Не удалось сохранить настройку. Повторите действие.",
                );
              } finally {
                setBusy(false);
              }
            }}
          />
          <span>
            Уведомлять о новых выездах
            <br />
            <span className="help">
              В уведомлениях сайта. Участие в выезде подтверждается отдельно.
            </span>
          </span>
        </label>
      )}
      {member && error && <p role="alert">{error}</p>}
    </>
  );
}
