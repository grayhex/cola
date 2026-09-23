"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import RichTextBody from "./rich-text-body.jsx";
import { useState, useEffect } from "react";
import { SocialHeader, SocialFooter, socialApi } from "./social-primitives.jsx";
import { useSite } from "./site-provider.jsx";
import Discussion from "./discussion.jsx";
import JournalEditor from "./journal-editor.jsx";
import { journalKinds } from "../../lib/journal-kinds.js";
import { Heart } from "./icons.jsx";
import { SaveEntry } from "./journal-card.jsx";
import { experienceHref } from "../../lib/experience-catalog.js";
export default function JournalPage({ share = null }) {
  const router = useRouter();
  const [bikes, setBikes] = useState([]);
  const [user, setUser] = useState(null),
    [entry, setEntry] = useState(null),
    [bike, setBike] = useState(null),
    [editing, setEditing] = useState(false),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false);
  const { setPreferences } = useSite();
  async function refresh() {
    const d = await socialApi("journal/public/" + share);
    setEntry(d.entry);
  }
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const m = await socialApi("me");
        if (!active) return;
        setUser(m.user);
        setPreferences(m.user?.preferences || {});
        if (share) {
          const d = await socialApi("journal/public/" + share);
          if (!active) return;
          setEntry(d.entry);
          setEditing(
            d.entry.isOwner &&
              new URLSearchParams(location.search).get("edit") === "1",
          );
        } else {
          if (!m.user) throw Error("Войдите в аккаунт, чтобы написать запись");
          const id = new URLSearchParams(location.search).get("bike");
          const d = await socialApi("bikes");
          if (!active) return;
          setBikes(d.bikes);
          if (id && !d.bikes.some((b) => b.id === id))
            throw Error(
              "Велосипед недоступен. Выберите свой велосипед в форме новой записи.",
            );
          setBike(d.bikes.find((b) => b.id === id) || null);
        }
        setLoaded(true);
      } catch (e) {
        if (active) setError(e.message);
      } finally {
        if (active) setLoaded(true);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [share]);
  const visible =
    entry?.status === "published" && entry.isPublic && entry.bikePublic;
  return (
    <>
      <SocialHeader user={user} />
      <main className="social-page journal-page">
        {error && <p role="alert">{error}</p>}
        {!loaded && !error && <p role="status">Загружаем запись…</p>}
        {!share && loaded && user && (
          <>
            {bike && (
              <Link href={"/account?tab=bikes&bike=" + bike.id}>
                К велосипеду
              </Link>
            )}
            <h1>Новая запись</h1>
            {bikes.length ? (
              <JournalEditor
                bikeId={bike?.id || ""}
                bikes={bikes}
                onSaved={(r) => router.push("/j/" + r.shareId)}
              />
            ) : (
              <section className="empty-state">
                <h2>Добавьте велосипед, чтобы вести его журнал</h2>
                <p>Запись всегда связана с одним из ваших велосипедов.</p>
                <Link className="button" href="/account?tab=bikes&action=add">
                  Добавить велосипед
                </Link>
              </section>
            )}
          </>
        )}
        {!share && loaded && !user && (
          <Link className="button" href="/login?next=%2Fj%2Fnew">
            Войти
          </Link>
        )}
        {entry &&
          (editing ? (
            <>
              <h1>Редактировать запись</h1>
              <JournalEditor
                entry={entry}
                onCancel={() => setEditing(false)}
                onSaved={async () => {
                  await refresh();
                  setEditing(false);
                }}
              />
            </>
          ) : (
            <>
              <a
                href={
                  entry.bikePublic
                    ? "/b/" + entry.bike.shareId
                    : "/account?tab=bikes&bike=" + entry.bike.id
                }
              >
                {entry.bike.name}
              </a>
              <div className="journal-entry-meta">
                <span>{journalKinds[entry.kind]}</span>
                {entry.status === "draft" ? (
                  <span>Черновик</span>
                ) : !visible ? (
                  <span>Приватная запись</span>
                ) : null}
                {entry.eventDate && <time>{entry.eventDate}</time>}
                {entry.mileage !== null && (
                  <span>{entry.mileage.toLocaleString("ru-RU")} км</span>
                )}
              </div>
              <h1>{entry.title || "Без заголовка"}</h1>
              <a href={"/u/" + entry.author.username}>
                @{entry.author.username}
              </a>
              <RichTextBody className="journal-body" body={entry.body} />
              {entry.installationResult && (
                <p>
                  Результат установки:{" "}
                  {
                    {
                      direct: "без доработок",
                      modified: "с доработками",
                      failed: "не подошло",
                    }[entry.installationResult]
                  }
                  .{" "}
                  <small>
                    Опыт владельца, не гарантия совместимости или безопасности.
                  </small>
                </p>
              )}
              {entry.solutionId && (
                <p className="journal-solution">
                  Решено автором ·{" "}
                  <a href={"?comment=" + entry.solutionId + "#discussion"}>
                    Выбранный ответ
                  </a>
                </p>
              )}
              <div className="journal-photos">
                {entry.photos.map((p, i) => (
                  <a key={p.id} href={p.url} target="_blank" rel="noopener">
                    <img
                      src={p.url + "?width=640"}
                      srcSet={`${p.url}?width=640 640w, ${p.url}?width=1280 1280w`}
                      sizes="(max-width: 700px) 100vw, 50vw"
                      alt={"Фотография записи " + (i + 1)}
                      loading="lazy"
                      decoding="async"
                    />
                  </a>
                ))}
              </div>
              {!!entry.components.length && (
                <section>
                  <h2>Компоненты в этой истории</h2>
                  <p className="help">
                    Состояние на момент добавления в запись.
                  </p>
                  {entry.components.map((c) => (
                    <article className="journal-part" key={c.id}>
                      <strong>
                        <a
                          href={experienceHref({
                            component: c.name,
                            componentCategory: c.category,
                          })}
                        >
                          {c.name}
                        </a>
                      </strong>
                      <span>{c.category}</span>
                      {c.price != null && (
                        <span>{Number(c.price).toLocaleString("ru-RU")} ₽</span>
                      )}
                      {c.notes && <p>{c.notes}</p>}
                      {/^https?:\/\//i.test(c.url) && (
                        <a
                          href={c.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Ссылка на компонент
                        </a>
                      )}
                      <small>
                        {new Date(c.capturedAt).toLocaleDateString("ru-RU")}
                      </small>
                    </article>
                  ))}
                </section>
              )}
              {entry.ride && (
                <a
                  className="journal-attached-ride"
                  href={
                    "/r/" +
                    entry.ride.shareId +
                    (entry.isOwner ? "?owner=1" : "")
                  }
                >
                  Покатушка: {entry.ride.title}
                </a>
              )}
              {entry.isOwner && (
                <div className="form-actions">
                  <button className="quiet" onClick={() => setEditing(true)}>
                    Редактировать запись
                  </button>
                  <button className="quiet" onClick={() => setConfirm(true)}>
                    Удалить запись
                  </button>
                  {confirm && (
                    <>
                      <span>
                        Удалить запись вместе с фотографиями и обсуждением?
                      </span>
                      <button
                        className="button"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            await socialApi("journal/" + entry.id, "DELETE");
                            location.assign(
                              "/account?tab=bikes&bike=" + entry.bike.id,
                            );
                          } catch (e) {
                            setError(e.message);
                            setBusy(false);
                          }
                        }}
                      >
                        Да, удалить запись
                      </button>
                      <button
                        className="quiet"
                        onClick={() => setConfirm(false)}
                      >
                        Отмена
                      </button>
                    </>
                  )}
                </div>
              )}
              {visible && (
                <>
                  <div className="journal-reactions">
                    <SaveEntry entry={entry} />
                    <button
                      className="quiet"
                      aria-label={"Нравится запись: " + entry.likes}
                      aria-pressed={entry.liked}
                      disabled={busy || entry.isOwner}
                      onClick={async () => {
                        if (!user) {
                          location.assign("/account");
                          return;
                        }
                        setBusy(true);
                        try {
                          const r = await socialApi(
                            "journal/" + entry.id + "/like",
                            entry.liked ? "DELETE" : "PUT",
                          );
                          setEntry((e) => ({ ...e, ...r }));
                        } catch (e) {
                          setError(e.message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      <Heart size={14} /> {entry.likes}
                    </button>
                  </div>
                  <Discussion
                    bike={entry}
                    user={user}
                    entityType="journal"
                    onSolution={refresh}
                  />
                </>
              )}
            </>
          ))}{" "}
      </main>
      <SocialFooter />
    </>
  );
}
