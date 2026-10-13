"use client";
import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { ClubPostView } from "./club-post-feed.tsx";
import { profilePath } from "../../lib/public-urls.ts";
import { useSite } from "./site-provider.tsx";
import { socialApi, Avatar } from "./social-primitives.tsx";
import { ReportButton } from "./community-controls.tsx";
import { useConfirmation } from "./confirmation.tsx";
import RichTextBody from "./rich-text-body.tsx";
import ZoomablePhoto from "./zoomable-photo.tsx";
import Discussion from "./discussion.tsx";
import styles from "./clubs.module.css";
export default function ClubPostReader({ initial }: { initial: ClubPostView }) {
  const { viewer } = useSite(),
    router = useRouter(),
    [post, setPost] = useState<ClubPostView | null>(initial),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [ask, confirmation] = useConfirmation();
  const refresh = useCallback(async () => {
    try {
      const data = await socialApi<{ post: ClubPostView }>(
        "club-posts/" + initial.id,
      );
      setPost(data.post);
      setError("");
    } catch (e) {
      setPost(null);
      setError(e instanceof Error ? e.message : "Публикация недоступна");
    }
  }, [initial.id]);
  useEffect(() => {
    let active = true;
    const load = () => {
      socialApi<{ post: ClubPostView }>("club-posts/" + initial.id)
        .then((data) => {
          if (active) {
            setPost(data.post);
            setError("");
          }
        })
        .catch((e) => {
          if (active) {
            setPost(null);
            setError(e.message);
          }
        });
    };
    load();
    window.addEventListener("focus", load);
    return () => {
      active = false;
      window.removeEventListener("focus", load);
    };
  }, [initial.id, viewer?.id]);
  async function action(path: string, method: string = "POST", data?: object) {
    setBusy(true);
    setError("");
    try {
      await socialApi("club-posts/" + initial.id + path, method, data);
      await refresh();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Не удалось выполнить действие",
      );
    } finally {
      setBusy(false);
    }
  }
  if (!post || (post.status === "draft" && post.author?.id !== viewer?.id))
    return (
      <section className={styles.page}>
        <h1>Публикация недоступна</h1>
        {error && <p role="alert">{error}</p>}
        <Link href={"/clubs/" + initial.club.id}>В клуб</Link>
      </section>
    );
  const own = post.author?.id === viewer?.id,
    rights = post.viewerId === viewer?.id,
    participate = rights && post.canParticipate;
  return (
    <article className={styles.page}>
      <Link href={"/clubs/" + post.club.id}>{post.club.name}</Link>
      <h1 className={styles.postTitle}>{post.title || "Публикация клуба"}</h1>
      <p className={styles.author}>
        {post.author && <Avatar person={post.author} />}
        <span>
          {post.author ? (
            <Link href={profilePath(post.author.username)}>
              {post.author.name}
            </Link>
          ) : (
            "Автор"
          )}{" "}
          ·{" "}
          <time dateTime={post.publishedAt || post.createdAt}>
            {new Date(post.publishedAt || post.createdAt).toLocaleDateString(
              "ru-RU",
            )}
          </time>
        </span>
        {post.pinned && <strong>Закреплено</strong>}
        {post.status === "draft" && (
          <strong>Черновик — виден только вам</strong>
        )}
      </p>
      <RichTextBody doc={post.bodyDoc} photos={post.photos} />
      <div className={styles.gallery}>
        {post.photos.map((photo) => (
          <ZoomablePhoto
            key={photo.id}
            src={photo.url}
            alt="Фотография к публикации клуба"
          />
        ))}
      </div>
      {post.status === "published" && (
        <div className={styles.actions}>
          <span>{post.likes} лайков</span>
          {viewer && !own && (participate || post.liked) && (
            <button
              className="button secondary"
              disabled={busy}
              aria-pressed={post.liked}
              onClick={() =>
                void action("/like", post.liked ? "DELETE" : "PUT")
              }
            >
              {post.liked ? "Убрать лайк" : "Нравится"}
            </button>
          )}
        </div>
      )}
      <div className={styles.actions}>
        {own && rights && post.canEdit && (
          <Link className="button secondary" href={post.href + "/edit"}>
            Редактировать
          </Link>
        )}
        {rights && post.canDelete && (
          <button
            className="quiet"
            disabled={busy}
            onClick={async () => {
              if (
                !(await ask("Удалить публикацию и фотографии?", {
                  confirmLabel: "Удалить",
                  danger: true,
                }))
              )
                return;
              setBusy(true);
              try {
                await socialApi("club-posts/" + post.id, "DELETE");
                router.push("/clubs/" + post.club.id);
                router.refresh();
              } catch (e) {
                setError(
                  e instanceof Error
                    ? e.message
                    : "Не удалось удалить публикацию",
                );
                setBusy(false);
              }
            }}
          >
            Удалить публикацию
          </button>
        )}
        {rights && post.canModerate && post.status === "published" && (
          <>
            <button
              className="quiet"
              disabled={busy}
              onClick={() =>
                void action("/moderation", "POST", {
                  action: post.pinned ? "unpin" : "pin",
                  version: post.version,
                })
              }
            >
              {post.pinned ? "Открепить" : "Закрепить"}
            </button>
            <button
              className="quiet"
              disabled={busy}
              onClick={async () => {
                if (
                  await ask("Скрыть публикацию из публичной ленты?", {
                    confirmLabel: "Скрыть",
                  })
                )
                  await action("/moderation", "POST", {
                    action: "hide",
                    version: post.version,
                  });
              }}
            >
              Скрыть публикацию
            </button>
          </>
        )}
        {!own && post.status === "published" && (
          <ReportButton
            user={viewer}
            entityType="club_post"
            targetId={post.id}
          />
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {post.status === "published" && (
        <Discussion
          key={post.id + ":" + viewer?.id}
          bike={post}
          user={viewer}
          entityType="club_post"
          canParticipate={participate}
          count={post.comments}
        />
      )}
      {confirmation}
    </article>
  );
}
