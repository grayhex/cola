"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import RidePassport from "./ride-passport.jsx";
import RideRsvp, { responseLabels } from "./ride-rsvp.jsx";
import RideShare from "./ride-share.jsx";
import { SharedView, useMotionFeedback } from "./motion.jsx";
import { Avatar, socialApi } from "./social-primitives.jsx";
import { useSite } from "./site-provider.jsx";
import { useHydrated } from "./use-hydrated.js";
import { profilePath } from "../../lib/public-urls.js";
import { personName } from "../../lib/usernames.js";
import { rideTimeLabel } from "../../lib/ride-announcement.js";
import { formatRideMetric } from "../../lib/garmin-fields.js";
import styles from "./ride-plan.module.css";

// Loaded on the first click; a failed chunk still leaves the login page.
const RideAuthDialog = dynamic(
  () =>
    import("./ride-auth-dialog.jsx").catch(() => ({
      default: function AuthLink({ onClose }) {
        return (
          <p role="alert" className="error">
            Не удалось открыть вход.{" "}
            <Link href="/login" onClick={onClose}>
              Открыть страницу входа
            </Link>
          </p>
        );
      },
    })),
  { ssr: false },
);

const changeLabels = {
  start: "время старта",
  place: "место встречи",
  route: "маршрут",
};
const stateLabels = {
  accepted: ["Идёт", "success"],
  reconfirm: ["Подтвердить заново", "warning"],
  maybe: ["Может быть", "info"],
  invited: ["Ждём ответа", "accent"],
  declined: ["Не идёт", undefined],
};
const dateOnly = (value, timeZone) =>
  new Date(value).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    timeZone,
  });
const timeOnly = (value, timeZone) =>
  new Date(value).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  });

/** The agreed time in the ride's zone; the reader's own clock is added after
 * hydration when it differs, so the server HTML stays the same for all. */
function RideTime({ ride }) {
  const hydrated = useHydrated();
  const zone = ride.recurrenceTimezone;
  const at = ride.scheduledAt;
  const agreed = dateOnly(at, zone) + ", " + timeOnly(at, zone);
  const localDay = hydrated ? dateOnly(at) : dateOnly(at, zone);
  const local = hydrated ? localDay + ", " + timeOnly(at) : agreed;
  return (
    <>
      <time dateTime={ride.scheduledAt} suppressHydrationWarning>
        {rideTimeLabel(ride.scheduledAt, zone)}
      </time>
      {ride.expectedEndAt && (
        <small suppressHydrationWarning>
          до {timeOnly(ride.expectedEndAt, zone)}
        </small>
      )}
      {ride.recurrence === "weekly" && <small>каждую неделю</small>}
      {local !== agreed && (
        <small>
          у вас{" "}
          {localDay === dateOnly(at, zone)
            ? timeOnly(at)
            : localDay + ", " + timeOnly(at)}
        </small>
      )}
    </>
  );
}

function participationNote(ride) {
  const hiddenPlace =
    ride.meetingVisibility === "participants"
      ? " Точное место встречи откроется после ответа «Иду»."
      : "";
  switch (ride.participation) {
    case "accepted":
      return [
        "success",
        ride.meetingVisibility === "participants"
          ? "Вы едете. Точное место встречи открыто вам как участнику."
          : "Вы едете.",
      ];
    case "maybe":
      return ["info", "Вы ответили «Может быть»." + hiddenPlace];
    case "declined":
      return [
        undefined,
        ride.canJoin
          ? "Вы ответили «Не иду». Можно передумать."
          : "Вы ответили «Не иду». Набор закрыт — вернуться можно только по приглашению организатора.",
      ];
    case "reconfirm":
      return [
        "warning",
        `Условия изменились — подтвердите заново. Раньше вы ответили «${responseLabels[ride.previousRsvp] || "Иду"}».`,
      ];
    case "invited":
      return [
        "accent",
        ride.recruitmentClosed
          ? "Вас пригласил организатор. Набор закрыт, но приглашённые могут ответить."
          : "Вас пригласил организатор — ответьте, поедете ли вы.",
      ];
    default:
      return ride.canJoin
        ? [
            undefined,
            "Отметьте, поедете ли вы. Ответ можно изменить." + hiddenPlace,
          ]
        : [
            "warning",
            "Набор закрыт: организатор больше не принимает новых участников.",
          ];
  }
}

/** The existing direct messages (#170, #217) with this ride as context. */
function AskOrganizer({ ride, share }) {
  const { viewer, chatEnabled } = useSite();
  if (ride.isOwner || !viewer) return null;
  if (!chatEnabled)
    return (
      <p className="help">
        Сообщения сейчас недоступны. Ответ об участии и договорённости работают
        без них.
      </p>
    );
  if (!viewer.email_verified_at)
    return (
      <p className="help">
        Чтобы написать организатору, подтвердите почту в{" "}
        <Link href="/account?tab=profile">профиле</Link>.
      </p>
    );
  return (
    <Link
      className="button secondary"
      href={
        "/messages?to=" +
        encodeURIComponent(ride.author.id) +
        "&ride=" +
        encodeURIComponent(share)
      }
    >
      Спросить организатора
    </Link>
  );
}

function Participation({ ride, share, onAnswer }) {
  const { viewer } = useSite();
  const [auth, setAuth] = useState(false);
  const [tone, text] = participationNote(ride);
  const note = useMotionFeedback(ride.participation, { reveal: true });
  const upcoming =
    ride.status === "planned" && new Date(ride.scheduledAt) > new Date();
  return (
    <section className={styles.panel} aria-labelledby="ride-participation">
      <h2 id="ride-participation">Участие</h2>
      {ride.status === "cancelled" ? (
        <p className="notice" data-tone="danger">
          Покатушка отменена организатором.
        </p>
      ) : !upcoming ? (
        <p className="help">Эта дата уже прошла.</p>
      ) : ride.isOwner ? (
        <p className="help">
          Вы организатор. Ответы участников — в сводке ниже.
        </p>
      ) : !viewer ? (
        <>
          <p>
            Войдите, чтобы ответить «Иду» или спросить организатора. Велосипед
            для участия не нужен.
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              className="button block"
              onClick={() => setAuth(true)}
            >
              Войти и ответить
            </button>
          </div>
        </>
      ) : (
        <>
          <p
            ref={note}
            className="notice"
            data-tone={tone}
            data-participation={ride.participation}
          >
            {text}
          </p>
          <RideRsvp ride={ride} onResponse={onAnswer} />
        </>
      )}
      {ride.status === "planned" && upcoming && viewer && (
        <AskOrganizer ride={ride} share={share} />
      )}
      {auth && <RideAuthDialog onClose={() => setAuth(false)} />}
    </section>
  );
}

function OrganizerPanel({ ride, onReload }) {
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
  const answers = ride.answers || { counts: {}, people: [] };
  const counts = answers.counts || {};
  const size = ride.passport?.groupSize;
  const zone = ride.recurrenceTimezone;
  async function act(key, path, method, body, done) {
    setBusy(key);
    setError("");
    setStatus("");
    try {
      await socialApi("rides/" + ride.id + "/" + path, method, body);
      setStatus(done);
      await onReload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }
  const occurrenceAt = new Date(ride.scheduledAt).toISOString();
  const day = dateOnly(ride.scheduledAt, zone);
  const warning =
    "Уже отправленные в мессенджеры превью ссылки могут остаться у получателей.";
  return (
    <section
      className={styles.panel}
      aria-labelledby="ride-organizer"
      data-organizer
    >
      <h2 id="ride-organizer">Ответы участников</h2>
      <dl className={styles.stats}>
        {[
          ["Идут", counts.accepted],
          ["Подтвердить заново", counts.reconfirm],
          ["Может быть", counts.maybe],
          ["Ждём ответа", counts.invited],
          ["Не идут", counts.declined],
        ].map(([label, n]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{n || 0}</dd>
          </div>
        ))}
      </dl>
      {size && (
        <p className="help">
          Желаемая компания:{" "}
          {size.min === size.max ? size.min : `${size.min}–${size.max}`} чел.
          Это ориентир, а не лимит: набор закрывается только вручную.
        </p>
      )}
      {answers.people.length > 0 ? (
        <ul className={styles.people} aria-label="Участники и приглашённые">
          {answers.people.map((p) => {
            const [label, tone] = stateLabels[p.state] || [p.state];
            return (
              <li key={p.author.id}>
                <Link
                  className={styles.person}
                  href={profilePath(p.author.username)}
                  prefetch={false}
                >
                  <Avatar person={p.author} size="tiny" />
                  {personName(p.author)}
                </Link>
                <span className={styles.states}>
                  <span className="badge" data-tone={tone}>
                    {label}
                  </span>
                  {p.invited && p.state !== "invited" && (
                    <span className="badge">по приглашению</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="help">Пока никто не ответил и никто не приглашён.</p>
      )}
      {answers.truncated && (
        <p className="help">Показаны первые 200 человек.</p>
      )}
      <hr className={styles.divider} />
      <div className={styles.actions}>
        <button
          type="button"
          className="button secondary"
          disabled={!!busy}
          aria-pressed={ride.recruitmentClosed}
          onClick={() =>
            act(
              "recruitment",
              "recruitment",
              "PATCH",
              { open: ride.recruitmentClosed, occurrenceAt },
              ride.recruitmentClosed ? "Набор снова открыт" : "Набор закрыт",
            )
          }
        >
          {ride.recruitmentClosed ? "Открыть набор" : "Закрыть набор"}
        </button>
        {ride.recurrence === "weekly" && (
          <button
            type="button"
            className="button secondary danger"
            disabled={!!busy}
            onClick={() =>
              confirm(
                `Отменить только выезд ${day}? Серия и другие даты останутся. ${warning}`,
              ) &&
              act(
                "occurrence",
                "cancel",
                "POST",
                { occurrenceAt },
                `Выезд ${day} отменён`,
              )
            }
          >
            Отменить выезд {day}
          </button>
        )}
        <button
          type="button"
          className="button secondary danger"
          disabled={!!busy}
          onClick={() =>
            confirm(
              (ride.recurrence === "weekly"
                ? "Отменить всю серию? "
                : "Отменить покатушку? ") + warning,
            ) &&
            act(
              "ride",
              "cancel",
              "POST",
              undefined,
              ride.recurrence === "weekly"
                ? "Серия отменена"
                : "Покатушка отменена",
            )
          }
        >
          {ride.recurrence === "weekly"
            ? "Отменить серию"
            : "Отменить покатушку"}
        </button>
        <Link
          className="button secondary"
          href={"/account?tab=rides&edit=" + encodeURIComponent(ride.shareId)}
        >
          Изменить
        </Link>
        <span className={styles.status} role="status">
          {busy ? "Сохраняем…" : status}
        </span>
      </div>
      <p className="help">
        Закрытый набор не отменяет уже ответивших и приглашённых. Существенное
        изменение времени, места или маршрута попросит участников подтвердить
        заново; исправление опечатки — нет.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}

/** A planned ride (#235): what was agreed, who organizes it and what the
 * viewer can do — every value from the API, nothing kept on the client. */
export default function RidePlanView({
  ride,
  share,
  sharePath,
  onAnswer,
  onReload,
}) {
  const zone = ride.recurrenceTimezone;
  const past =
    ride.status === "planned" && new Date(ride.scheduledAt) <= new Date();
  const changes = ride.agreement?.changes || [];
  const changed = (aspect) =>
    ride.agreement?.revision > 1 && changes.includes(aspect) ? (
      <span className="badge" data-tone="warning">
        изменено
      </span>
    ) : null;
  const size = ride.passport?.groupSize;
  const open = ride.isPublic !== false && ride.bikePublic !== false;
  const distance =
    ride.hasTrack && formatRideMetric(ride.metrics?.distanceM, "distance");
  const notice = useMotionFeedback(ride.agreement?.revision, { reveal: true });
  return (
    <>
      <header className={styles.head}>
        <SharedView kind="ride-title" id={ride.id}>
          <h1>{ride.title}</h1>
        </SharedView>
        <div className={styles.meta}>
          <Link
            className={styles.person}
            href={profilePath(ride.author.username)}
            prefetch={false}
          >
            <Avatar person={ride.author} size="tiny" />
            {personName(ride.author)}
            <span className="sr-only">, организатор</span>
          </Link>
          {ride.status === "cancelled" ? (
            <span className="badge" data-tone="danger">
              Отменена
            </span>
          ) : past ? (
            <span className="badge">Дата прошла</span>
          ) : ride.recruitmentClosed ? (
            <span className="badge" data-tone="warning">
              Набор закрыт
            </span>
          ) : (
            <span className="badge" data-tone="info">
              Набор открыт
            </span>
          )}
          <span className="badge">
            {open ? "Открытая покатушка" : "По приглашению"}
          </span>
        </div>
      </header>
      <div className={styles.layout}>
        <section className={styles.agreement} aria-labelledby="ride-terms">
          <h2 id="ride-terms">Договорённости</h2>
          {ride.agreement?.revision > 1 && changes.length > 0 && (
            <p ref={notice} className="notice" data-tone="warning">
              Организатор изменил условия
              {ride.agreement.changedAt
                ? " " + dateOnly(ride.agreement.changedAt, zone)
                : ""}
              : {changes.map((c) => changeLabels[c]).join(", ")}.
            </p>
          )}
          {ride.cancelledOccurrences?.length > 0 && (
            <p className="notice" data-tone="danger">
              Отменены выезды:{" "}
              {ride.cancelledOccurrences
                .map((d) => dateOnly(d, zone))
                .join(", ")}
              . Серия продолжается.
            </p>
          )}
          <dl className={styles.terms}>
            <div>
              <dt>Когда</dt>
              <dd>
                <RideTime ride={ride} />
                {changed("start")}
              </dd>
            </div>
            <div>
              <dt>Место встречи</dt>
              <dd>
                {ride.meetingPoint ? (
                  ride.meetingPoint
                ) : ride.meetingHidden ? (
                  <span className={styles.hidden}>
                    Откроется участникам после ответа «Иду»
                  </span>
                ) : (
                  <span className={styles.hidden}>
                    Организатор пока не указал
                  </span>
                )}
                {changed("place")}
              </dd>
            </div>
            {ride.passport?.area?.label && (
              <div>
                <dt>Район</dt>
                <dd>{ride.passport.area.label}</dd>
              </div>
            )}
            <div>
              <dt>Маршрут</dt>
              <dd>
                {ride.hasTrack
                  ? "Трек добавлен" + (distance ? " · " + distance : "")
                  : "Пока не добавлен"}
                {changed("route")}
              </dd>
            </div>
            <div>
              <dt>Набор</dt>
              <dd>
                {ride.status === "cancelled"
                  ? "Покатушка отменена"
                  : ride.recruitmentClosed
                    ? "Закрыт организатором"
                    : "Открыт"}
                {size && (
                  <small>
                    желаемая компания{" "}
                    {size.min === size.max
                      ? size.min
                      : `${size.min}–${size.max}`}{" "}
                    чел.
                  </small>
                )}
              </dd>
            </div>
          </dl>
        </section>
        <div className={styles.format}>
          <h2>Формат</h2>
          <RidePassport passport={ride.passport} map />
          {ride.features?.length > 0 && (
            <ul className="ride-features">
              {ride.features.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          )}
        </div>
        <aside className={styles.aside} aria-label="Участие и приглашение">
          <Participation ride={ride} share={share} onAnswer={onAnswer} />
          {ride.status === "planned" && !past && (
            <RideShare ride={ride} sharePath={sharePath} />
          )}
        </aside>
      </div>
      {ride.isOwner && ride.status === "planned" && ride.answers && (
        <div className={styles.section}>
          <OrganizerPanel ride={ride} onReload={onReload} />
        </div>
      )}
    </>
  );
}
