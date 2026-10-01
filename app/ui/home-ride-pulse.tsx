"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { ViewerDto, JsonData } from "../../lib/contracts.ts";
import type { ridePulsePeople } from "../../lib/ride-pulse.ts";
import type { HomeSnapshot } from "./home.tsx";
import { Avatar } from "./avatar.tsx";
import { profilePath } from "../../lib/public-urls.ts";
import { plural } from "../../lib/plural.ts";
import { personName } from "../../lib/usernames.ts";
import { useMotionFeedback } from "./motion.tsx";
import styles from "./home.module.css";

type People = JsonData<Awaited<ReturnType<typeof ridePulsePeople>>>;
function PulsePeople({ revision }: { revision?: string }) {
  const [data, setData] = useState<People | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/ride-intents/pulse", {
      signal: controller.signal,
      cache: "no-store",
    })
      .then((r) => {
        if (!r.ok) throw Error();
        return r.json() as Promise<People>;
      })
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setData(null);
      });
    return () => controller.abort();
  }, [revision]);
  if (!data?.people.length) return null;
  return (
    <ul
      className={styles.pulsePeople}
      aria-label="Участники с ближайшими окнами"
    >
      {data.people.map(({ author, startsAt }) => (
        <li key={author.id}>
          <Link prefetch={false} href={profilePath(author.username)}>
            <Avatar person={author} />
            <span>
              {personName(author)}
              <small>
                {new Intl.DateTimeFormat("ru", {
                  timeZone: data.timeZone,
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                }).format(new Date(startsAt))}
              </small>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
export default function RidePulse({
  pulse,
  user,
  error,
}: {
  pulse?: HomeSnapshot["pulse"];
  user: ViewerDto | null;
  error: boolean;
}) {
  const count = useMotionFeedback<HTMLSpanElement>(pulse?.total);
  return (
    <div className={styles.pulse} data-ride-pulse aria-busy={!pulse && !error}>
      <p className={styles.pulseHeadline}>
        <span ref={count} className={styles.pulseCount}>
          {pulse?.total ?? "—"}
        </span>
        <span>
          {plural(
            pulse?.total ?? 0,
            "Участник планирует",
            "Участника планируют",
            "Участников планируют",
          )}
          <br />
          покататься
        </span>
      </p>
      {pulse ? (
        <>
          <ul className={styles.pulseBuckets}>
            {pulse.buckets.map((bucket) => (
              <li key={bucket.key}>
                {bucket.label}
                <strong>{bucket.count}</strong>
              </li>
            ))}
          </ul>
          <p className={styles.pulseSummary}>
            {pulse.total
              ? `${pulse.ready} готовы ехать · ${pulse.considering} пока присматриваются`
              : "Пока нет открытых планов. Отметьте удобное время — компания начинается с вас."}
          </p>
          <p className={styles.pulseNote}>
            Ближайшее окно каждого участника · время московское
          </p>
        </>
      ) : (
        <p className={styles.pulseSummary}>
          {error
            ? "Планы появятся после загрузки."
            : "Загружаем планы сообщества…"}
        </p>
      )}
      {user && pulse && <PulsePeople key={user.id} revision={pulse?.asOf} />}
      {!user && (
        <Link className="text-link" href="/login?next=%2Fride-intents">
          Войдите, чтобы увидеть участников →
        </Link>
      )}
    </div>
  );
}
