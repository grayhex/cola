"use client";
import RideCard from "./ride-card.jsx";
import JournalCard from "./journal-card.jsx";
import { Check } from "./icons.jsx";
import BikeGrid from "./bike-grid.jsx";
import { useEffect, useState, useRef } from "react";
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
const eventText = {
  journal_like: "понравилась ваша запись",
  journal_comment: "прокомментировал запись",
  journal_reply: "ответил вам в журнале",
  ride_like: "понравилась ваша покатушка",
  ride_comment: "прокомментировал покатушку",
  ride_reply: "ответил вам",
  follow: "подписался на вас",
  like: "понравился ваш велосипед",
  comment: "прокомментировал",
  reply: "ответил вам",
};
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
  const [user, setUser] = useState(undefined),
    [data, setData] = useState(null),
    [page, setPage] = useState(1),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const { setPreferences } = useSite();
  const requestRevision = useRef(0);
  async function refresh() {
    const revision = ++requestRevision.current;
    const d = await socialApi(
      "community/" +
        (kind === "journal" ? "feed" : kind) +
        "?page=" +
        page +
        (kind === "journal"
          ? "&type=journal&mode=" + mode
          : feedType === "rides"
            ? "&type=rides"
            : ""),
    );
    if (revision !== requestRevision.current) return;
    setData(d);
    setError("");
    if (kind === "notifications")
      window.dispatchEvent(new Event("cola:notifications"));
  }
  useEffect(() => {
    socialApi("me")
      .then((d) => {
        setUser(d.user);
        setPreferences(d.user?.preferences || {});
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if ((user || (kind === "journal" && mode === "new")) && feedType !== null)
      refresh().catch((e) => setError(e.message));
    return () => {
      requestRevision.current++;
    };
  }, [user?.id, page, feedType, mode]);
  useEffect(() => {
    if (!user || kind !== "notifications") return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible")
        refresh().catch((e) => setError(e.message));
    }, 30000);
    return () => clearInterval(timer);
  }, [user?.id, page, kind]);
  async function read(id) {
    await socialApi("community/notifications/" + id + "/read", "PATCH");
    await refresh();
  }
  return (
    <>
      <SocialHeader user={user} />
      <main className="social-page community-page">
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
        {kind === "journal" && (
          <nav className="journal-modes" aria-label="Режим журнала">
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
                ? "сохранённые записи"
                : "уведомления"}
            .{" "}
            <a className="button small" href="/account">
              Войти
            </a>
          </p>
        ) : !data ? (
          <p role="status">Загружаем…</p>
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
                ) : b.kind === "ride" ? (
                  <RideCard key={b.id} ride={b} />
                ) : (
                  <BikeCard
                    key={b.id}
                    bike={b}
                    busy={busy}
                    onLike={async () => {
                      setBusy(true);
                      try {
                        await socialApi(
                          "bikes/" + b.id + "/like",
                          b.liked ? "DELETE" : "PUT",
                        );
                        await refresh();
                      } catch (e) {
                        setError(e.message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  />
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
                <a className="button" href="/">
                  Открыть витрину
                </a>
              </section>
            )}
            <Pagination {...data} onPage={setPage} />
          </>
        ) : (
          <>
            <ul className="notification-list">
              {data.notifications.map((n) => (
                <li key={n.id} className={n.readAt ? "" : "unread"}>
                  <a
                    href={"/u/" + n.actor.username}
                    aria-label={"Профиль @" + n.actor.username}
                  >
                    <Avatar person={n.actor} />
                  </a>
                  <div>
                    <p>
                      <a
                        className="notification-actor"
                        href={"/u/" + n.actor.username}
                      >
                        @{n.actor.username}
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
              ))}
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
