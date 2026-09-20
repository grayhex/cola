"use client";
import RideCard from "./ride-card.jsx";
import { Check } from "./icons.jsx";
import BikeGrid from "./bike-grid.jsx";
import { useEffect, useState } from "react";
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
  async function refresh() {
    const d = await socialApi(
      "community/" +
        kind +
        "?page=" +
        page +
        (feedType === "rides" ? "&type=rides" : ""),
    );
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
    if (user && feedType !== null) refresh().catch((e) => setError(e.message));
  }, [user?.id, page, feedType]);
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
            {kind === "feed"
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
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {user === null ? (
          <p>
            Войдите, чтобы увидеть{" "}
            {kind === "feed" ? "публикации ваших подписок" : "уведомления"}.{" "}
            <a className="button small" href="/account">
              Войти
            </a>
          </p>
        ) : !data ? (
          <p role="status">Загружаем…</p>
        ) : kind === "feed" ? (
          <>
            <p className="help">
              Новые публикации владельцев, на которых вы подписаны.
            </p>
            <BikeGrid bikes={data.bikes}>
              {(data.items || data.bikes).map((b) =>
                b.kind === "ride" ? (
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
