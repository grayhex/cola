"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import RichTextBody from "./rich-text-body.jsx";
import { useState, useEffect, useRef } from "react";
import { SocialHeader, SocialFooter, socialApi } from "./social-primitives.jsx";
import { useSite } from "./site-provider.jsx";
import { journalKinds } from "../../lib/journal-kinds.js";
import { Heart } from "./icons.jsx";
import { SaveEntry } from "./journal-card.jsx";
import { experienceHref } from "../../lib/experience-catalog.js";
import dynamic from "next/dynamic";
import { profilePath, publicPath } from "../../lib/public-urls.js";
import { personName } from "../../lib/usernames.js";
import ShareButton from "./share-button.jsx";
import LocalDate from "./local-date.jsx";
// The owner's editor and the comment composer load after the entry itself.
const Discussion = dynamic(() => import("./discussion.jsx"), { ssr: false });
const JournalEditor = dynamic(() => import("./journal-editor.jsx"), {
  ssr: false,
});
export default function JournalPage({
  share = null,
  sharePath = null,
  initial = null,
}) {
  const router = useRouter();
  const [bikes, setBikes] = useState([]);
  const [entry, setEntry] = useState(initial?.entry || null),
    [bike, setBike] = useState(null),
    [editing, setEditing] = useState(false),
    [loaded, setLoaded] = useState(!!initial),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false);
  const { viewer: user } = useSite();
  // The server rendered the entry for this viewer (#74): the first load
  // reuses it instead of asking again.
  const seed = useRef(initial);
  async function refresh() {
    const d = await socialApi("journal/public/" + share);
    setEntry(d.entry);
  }
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        if (share) {
          const d =
            seed.current || (await socialApi("journal/public/" + share));
          seed.current = null;
          if (!active) return;
          setEntry(d.entry);
          setEditing(
            d.entry.isOwner &&
              new URLSearchParams(location.search).get("edit") === "1",
          );
        } else {
          if (!user) throw Error("Войдите в аккаунт, чтобы написать запись");
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
                onSaved={(r) => router.push(publicPath("journal", r))}
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
                    ? publicPath("bike", entry.bike)
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
              <div className="entity-byline">
                <a href={profilePath(entry.author.username)}>
                  {personName(entry.author)}
                </a>
                <ShareButton
                  path={visible ? sharePath : null}
                  title={entry.title || "Запись в Журнале ColaBike"}
                />
              </div>
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
                        <LocalDate value={c.capturedAt} />
                      </small>
                    </article>
                  ))}
                </section>
              )}
              {entry.ride && (
                <a
                  className="journal-attached-ride"
                  href={
                    publicPath("ride", entry.ride) +
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
