"use client";
import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import type { JsonData } from "../../lib/contracts.ts";
import type { ClubPostDto, clubPostList } from "../../lib/club-posts.ts";
import type { ClubDto } from "../../lib/club-contracts.ts";
import { useSite } from "./site-provider.tsx";
import { socialApi, Avatar } from "./social-primitives.tsx";
import { PageControls } from "./community-controls.tsx";
import styles from "./clubs.module.css";
export type ClubPostView = JsonData<ClubPostDto>;
export type ClubFeedView = JsonData<Awaited<ReturnType<typeof clubPostList>>>;
export default function ClubPostFeed({
  club,
  initial,
}: {
  club: ClubDto;
  initial: ClubFeedView;
}) {
  const { viewer } = useSite(),
    [data, setData] = useState(initial),
    [page, setPage] = useState(1),
    [own, setOwn] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const viewerId = viewer?.id;
  const active =
    club.membership?.userId === viewer?.id &&
    club.membership?.state === "active" &&
    !club.archived;
  useEffect(() => {
    let current = true;
    setBusy(true);
    setError("");
    setData(
      page === 1 && !own ? initial : { ...initial, pinned: null, posts: [] },
    );
    socialApi<ClubFeedView>(
      "club-posts?clubId=" +
        club.id +
        "&page=" +
        page +
        (own && viewerId ? "&own=1" : ""),
    )
      .then((next) => {
        if (current) setData(next);
      })
      .catch((e) => {
        if (current) setError(e.message);
      })
      .finally(() => {
        if (current) setBusy(false);
      });
    return () => {
      current = false;
    };
  }, [club.id, page, own, viewerId, initial]);
  return (
    <section aria-label="Публикации клуба" className={styles.feed}>
      <div className={styles.actions}>
        <h2>Лента клуба</h2>
        {active && (
          <Link className="button" href={"/clubs/" + club.id + "/posts/new"}>
            Написать в клуб
          </Link>
        )}
      </div>
      {viewer && (
        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={own}
            onChange={(e) => {
              setOwn(e.target.checked);
              setPage(1);
            }}
          />
          Только мои публикации и черновики
        </label>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {busy && <p role="status">Загружаем публикации…</p>}
      {!busy && !error && !data.posts.length && !data.pinned && (
        <p className={styles.notice}>
          {own
            ? "У вас пока нет публикаций в этом клубе."
            : "Здесь появятся истории, вопросы и новости участников клуба."}
        </p>
      )}
      <div className={styles.posts}>
        {[...(data.pinned ? [data.pinned] : []), ...data.posts].map((post) => (
          <article key={post.id} className={styles.post}>
            <div className={styles.author}>
              {post.author && <Avatar person={post.author} />}
              <span>
                {post.author?.name} ·{" "}
                <time dateTime={post.publishedAt || post.createdAt}>
                  {new Date(
                    post.publishedAt || post.createdAt,
                  ).toLocaleDateString("ru-RU")}
                </time>
              </span>
              {post.pinned && <strong>Закреплено</strong>}
              {post.status === "draft" && <strong>Черновик</strong>}
            </div>
            <h3>
              <Link href={post.href}>
                {post.title || post.excerpt || "Публикация с фотографиями"}
              </Link>
            </h3>
            {post.title && <p>{post.excerpt}</p>}
            {post.photos[0] && (
              <Link href={post.href} tabIndex={-1} aria-hidden="true">
                <Image
                  unoptimized
                  width={1600}
                  height={900}
                  className={styles.postPhoto}
                  src={post.photos[0].url + "?width=640"}
                  alt=""
                  loading="lazy"
                />
              </Link>
            )}
            <p className={styles.meta}>
              {post.likes} лайков · {post.comments} комментариев
            </p>
          </article>
        ))}
      </div>
      {!busy && <PageControls {...data} onPage={setPage} />}
    </section>
  );
}
