"use client";
import Link from "next/link";
import { MarketCard } from "./market.jsx";
import RideCard from "./ride-card.jsx";
import JournalCard from "./journal-card.jsx";
import {
  Check,
  MessagesSquare,
  Users,
  NotebookPen,
  ShoppingBag,
  RefreshCw,
} from "./icons.jsx";
import LocalDate from "./local-date.jsx";
import { daysLabel } from "../../lib/market-types.js";
import BikeGrid from "./bike-grid.jsx";
import { useCallback, useEffect, useState, useRef } from "react";
import {
  SocialHeader,
  SocialFooter,
  Avatar,
  Pagination,
  socialApi,
} from "./social-primitives.jsx";
import { PageControls } from "./community-controls.jsx";
import BikeCard from "./bike-card.jsx";
import { useSite } from "./site-provider.jsx";
import { profilePath } from "../../lib/public-urls.js";
import { personName } from "../../lib/usernames.js";
const eventText = {
  component_reply: "ответил вам в обсуждении компонента",
  article_like: "понравилась ваша статья",
  article_comment: "прокомментировал статью",
  article_reply: "ответил вам в статье",
  journal_like: "понравилась ваша запись",
  journal_comment: "прокомментировал запись",
  journal_reply: "ответил вам в журнале",
  ride_invite: "приглашает на покатушку",
  ride_like: "понравилась ваша покатушка",
  ride_comment: "прокомментировал покатушку",
  ride_reply: "ответил вам",
  follow: "подписался на вас",
  like: "понравился ваш велосипед",
  comment: "прокомментировал",
  reply: "ответил вам",
};
const noticeTime = (value) =>
  new Date(value).toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
// The site's notice about a listing's term (#116). The text follows the
// listing as it is now: extended, sold or still ending.
function MarketNotice({ notice: n, days, busy, onExtend, onRead }) {
  const listing = (
    <a href={n.target.href} onClick={() => !n.readAt && onRead()}>
      {n.target.name}
    </a>
  );
  const until = (
    <LocalDate
      value={n.target.expiresAt}
      options={{ day: "numeric", month: "long" }}
    />
  );
  return (
    <li className={n.readAt ? "" : "unread"}>
      <span className="notification-icon" aria-hidden="true">
        <ShoppingBag size={18} />
      </span>
      <div>
        <p>
          {n.target.state === "expiring" ? (
            <>
              Объявление {listing} снимется с публикации {until}. Продлите его,
              если оно ещё актуально.
            </>
          ) : n.target.state === "expired" ? (
            <>Срок объявления {listing} истёк: его нет в поиске и ленте.</>
          ) : n.target.state === "extended" ? (
            <>
              Объявление {listing} продлено до {until}.
            </>
          ) : (
            <>Объявление {listing} снято с публикации.</>
          )}
        </p>
        {["expiring", "expired"].includes(n.target.state) && (
          <button
            type="button"
            className="button small"
            disabled={busy}
            onClick={onExtend}
          >
            <RefreshCw size={14} aria-hidden="true" />
            Продлить на {daysLabel(days)}
          </button>
        )}
        <time dateTime={n.createdAt}>{noticeTime(n.createdAt)}</time>
      </div>
      {!n.readAt && (
        <button
          className="quiet"
          aria-label="Отметить прочитанным"
          onClick={onRead}
        >
          <Check size={14} />
        </button>
      )}
    </li>
  );
}
export default function CommunityPage({ kind }) {
  const [mode, setMode] = useState("new");
  useEffect(
    () =>
      setMode(
        new URLSearchParams(location.search).get("mode") === "following"
          ? "following"
          : "new",
      ),
    [],
  );
  const [feedType, setFeedType] = useState(null);
  useEffect(
    () =>
      setFeedType(
        new URLSearchParams(location.search).get("type") === "rides"
          ? "rides"
          : "all",
      ),
    [],
  );
  // /saved → «Записи» or «Объявления» (#116).
  const [savedType, setSavedType] = useState(null);
  useEffect(
    () =>
      setSavedType(
        new URLSearchParams(location.search).get("type") === "market"
          ? "market"
          : "journal",
      ),
    [],
  );
  const [data, setData] = useState(null),
    [page, setPage] = useState(1),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const { viewer: user, settings } = useSite();
  const userId = user?.id;
  const requestRevision = useRef({ revision: 0 });
  const refresh = useCallback(async () => {
    const revision = ++requestRevision.current.revision;
    try {
      const d = await socialApi(
        kind === "saved" && savedType === "market"
          ? "market/saved?page=" + page
          : "community/" +
              (kind === "journal" ? "feed" : kind) +
              "?page=" +
              page +
              (kind === "journal"
                ? "&type=journal&mode=" + mode
                : feedType === "rides"
                  ? "&type=rides"
                  : ""),
      );
      if (revision !== requestRevision.current.revision) return;
      setData(d);
      setError("");
      if (kind === "notifications")
        window.dispatchEvent(new Event("cola:notifications"));
    } catch (e) {
      if (revision === requestRevision.current.revision) setError(e.message);
    }
  }, [kind, savedType, page, mode, feedType]);
  useEffect(() => {
    const pending = requestRevision.current;
    if (
      (userId || (kind === "journal" && mode === "new")) &&
      feedType !== null &&
      savedType !== null
    )
      refresh().catch((e) => setError(e.message));
    return () => {
      pending.revision++;
    };
  }, [userId, kind, feedType, mode, savedType, refresh]);
  useEffect(() => {
    if (!userId || kind !== "notifications") return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible")
        refresh().catch((e) => setError(e.message));
    }, 30000);
    return () => clearInterval(timer);
  }, [userId, kind, refresh]);
  async function read(id) {
    await socialApi("community/notifications/" + id + "/read", "PATCH");
    await refresh();
  }
  // «Продлить» right in the notice: one click, a new full term (#116).
  async function extend(n) {
    setBusy(true);
    setError("");
    try {
      await socialApi("market/" + n.target.id + "/extend", "POST");
      if (!n.readAt)
        await socialApi("community/notifications/" + n.id + "/read", "PATCH");
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <SocialHeader user={user} />
      <main className="page community-page">
        <div className="section-heading">
          <h1>
            {kind === "journal"
              ? "Журнал"
              : kind === "saved"
                ? "Сохранённое"
                : kind === "feed"
                  ? feedType === "rides"
                    ? "Покатушки подписок"
                    : "Подписки"
                  : "Уведомления"}
          </h1>
          {kind === "notifications" && !!data?.unread && (
            <button
              className="quiet"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await socialApi("community/notifications/read-all", "PATCH");
                  await refresh();
                } catch (e) {
                  setError(e.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Прочитать все
            </button>
          )}
        </div>
        {kind === "saved" && user && (
          <nav className="ui-tabs" aria-label="Что сохранено">
            {[
              ["journal", "Записи", NotebookPen],
              ["market", "Объявления", ShoppingBag],
            ].map(([id, label, Icon]) => (
              <button
                key={id}
                className="quiet"
                aria-pressed={savedType === id}
                onClick={() => {
                  if (savedType === id) return;
                  setSavedType(id);
                  setPage(1);
                  setData(null);
                  setError("");
                  history.replaceState(
                    null,
                    "",
                    id === "market" ? "/saved?type=market" : "/saved",
                  );
                }}
              >
                <Icon size={17} aria-hidden="true" />
                {label}
              </button>
            ))}
          </nav>
        )}
        {kind === "journal" && (
          <nav className="journal-modes ui-tabs" aria-label="Режим журнала">
            {[
              ["new", "Новые"],
              ["following", "Подписки"],
            ].map(([id, label]) => (
              <button
                key={id}
                className="quiet"
                aria-pressed={mode === id}
                onClick={() => {
                  setMode(id);
                  setPage(1);
                  setData(null);
                  setError("");
                  history.replaceState(
                    null,
                    "",
                    id === "new" ? "/journal" : "/journal?mode=following",
                  );
                }}
              >
                {id === "new" ? (
                  <MessagesSquare size={17} aria-hidden="true" />
                ) : (
                  <Users size={17} aria-hidden="true" />
                )}
                {label}
              </button>
            ))}
          </nav>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {user === null && !(kind === "journal" && mode === "new") ? (
          <p>
            Войдите, чтобы увидеть{" "}
            {kind === "feed" || kind === "journal"
              ? "публикации ваших подписок"
              : kind === "saved"
                ? "сохранённые записи и объявления"
                : "уведомления"}
            .{" "}
            <Link className="button small" href="/account">
              Войти
            </Link>
          </p>
        ) : !data ? (
          <p role="status">Загружаем…</p>
        ) : kind === "saved" && savedType === "market" ? (
          <>
            <BikeGrid>
              {data.items.map((m) => (
                <MarketCard key={m.id} listing={m} />
              ))}
            </BikeGrid>
            {!data.items.length && (
              <section className="social-empty">
                <h2>Сохранённых объявлений нет</h2>
                <p>
                  Сохраняйте объявления кнопкой «Сохранить». Проданные, снятые и
                  истёкшие здесь не показываются.
                </p>
                <Link href="/market">Открыть рынок</Link>
              </section>
            )}
            <Pagination {...data} onPage={setPage} />
          </>
        ) : kind === "journal" || kind === "saved" ? (
          <>
            <div className="journal-feed">
              {(data.entries || data.items).map((e) => (
                <JournalCard
                  key={e.id}
                  entry={e}
                  onSaved={() => {
                    if (kind === "saved")
                      refresh().catch((e) => setError(e.message));
                  }}
                />
              ))}
            </div>
            {!(data.entries || data.items).length && (
              <section className="social-empty">
                <h2>
                  {kind === "saved"
                    ? "Пока ничего не сохранено"
                    : "Здесь пока нет историй"}
                </h2>
                <p>
                  {kind === "saved"
                    ? "Сохраняйте полезные записи, чтобы вернуться к ним."
                    : mode === "following"
                      ? "Подпишитесь на интересного автора или велосипед — свой велосипед для этого не нужен."
                      : "Истории владельцев появятся после публикации."}
                </p>
                <a href={kind === "saved" ? "/journal" : "/"}>
                  {kind === "saved"
                    ? "Открыть журнал"
                    : "Посмотреть велосипеды"}
                </a>
              </section>
            )}
            <Pagination {...data} onPage={setPage} />
          </>
        ) : kind === "feed" ? (
          <>
            <p className="help">
              Новые публикации владельцев, на которых вы подписаны.
            </p>
            <BikeGrid bikes={data.bikes}>
              {(data.items || data.bikes).map((b) =>
                b.kind === "journal" ? (
                  <JournalCard key={b.id} entry={b} />
                ) : b.kind === "market" ? (
                  <MarketCard key={b.id} listing={b} />
                ) : b.kind === "ride" ? (
                  <RideCard key={b.id} ride={b} />
                ) : (
                  <BikeCard key={b.id} bike={b} user={user} />
                ),
              )}
            </BikeGrid>
            {!(data.items || data.bikes).length && (
              <section className="social-empty">
                <h2>Публикации знакомых появятся здесь</h2>
                <p>
                  Найдите интересных владельцев на общей витрине и подпишитесь
                  на них.
                </p>
                <Link className="button" href="/">
                  Открыть витрину
                </Link>
              </section>
            )}
            <Pagination {...data} onPage={setPage} />
          </>
        ) : (
          <>
            <ul className="notification-list">
              {data.notifications.map((n) =>
                n.type === "market_expiring" ? (
                  <MarketNotice
                    key={n.id}
                    notice={n}
                    days={settings?.marketListingDays || 60}
                    busy={busy}
                    onExtend={() => extend(n)}
                    onRead={() => read(n.id).catch((e) => setError(e.message))}
                  />
                ) : (
                  <li key={n.id} className={n.readAt ? "" : "unread"}>
                    <a
                      href={profilePath(n.actor.username)}
                      aria-label={"Профиль: " + personName(n.actor)}
                    >
                      <Avatar person={n.actor} />
                    </a>
                    <div>
                      <p>
                        <a
                          className="notification-actor"
                          href={profilePath(n.actor.username)}
                        >
                          {personName(n.actor)}
                        </a>
                        {" " + eventText[n.type] + " "}
                        {n.type !== "follow" && (
                          <a
                            href={n.target.href}
                            onClick={() => {
                              read(n.id).catch(() => {});
                            }}
                          >
                            {n.type === "reply"
                              ? "в обсуждении " + n.target.name
                              : n.target.name}
                          </a>
                        )}
                      </p>
                      <time dateTime={n.createdAt}>
                        {new Date(n.createdAt).toLocaleString("ru-RU", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                    </div>
                    {!n.readAt && (
                      <button
                        className="quiet"
                        aria-label="Отметить прочитанным"
                        onClick={() =>
                          read(n.id).catch((e) => setError(e.message))
                        }
                      >
                        <Check size={14} />
                      </button>
                    )}
                  </li>
                ),
              )}
            </ul>
            {!data.notifications.length && (
              <p className="help">
                Здесь появятся реакции на ваши велосипеды, ответы и новые
                подписчики.
              </p>
            )}
            <PageControls {...data} onPage={setPage} />
          </>
        )}
      </main>
      <SocialFooter />
    </>
  );
}
