"use client";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import ZoomablePhoto from "./zoomable-photo.jsx";
import { socialApi } from "./social-primitives.jsx";
import { ReportButton } from "./community-controls.jsx";
import EmailPolicyAction from "./email-policy-action.jsx";
import { profilePath } from "../../lib/public-urls.js";
import { personName } from "../../lib/usernames.js";
import styles from "./component-gallery.module.css";

function PhotoActions({ photo, run, busy, path }) {
  const [editing, setEditing] = useState(false),
    [caption, setCaption] = useState(photo.caption),
    [deleting, setDeleting] = useState(false);
  return (
    <>
      {editing ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await run(() =>
                socialApi(path + "/" + photo.id, "PATCH", {
                  version: photo.version,
                  caption,
                }),
              )
            )
              setEditing(false);
          }}
        >
          <label className="field">
            <span>Подпись к фото</span>
            <textarea
              value={caption}
              maxLength={300}
              rows={2}
              onChange={(e) => setCaption(e.target.value)}
              disabled={busy}
            />
          </label>
          <div className={styles.actions}>
            <button className="button secondary small" disabled={busy}>
              Сохранить подпись
            </button>
            <button
              type="button"
              className="quiet"
              onClick={() => setEditing(false)}
              disabled={busy}
            >
              Отмена
            </button>
          </div>
        </form>
      ) : (
        <button
          className="quiet"
          onClick={() => setEditing(true)}
          disabled={busy}
        >
          Изменить подпись
        </button>
      )}
      {deleting ? (
        <div className={styles.actions}>
          <span>Удалить фото навсегда?</span>
          <button
            className="button danger small"
            disabled={busy}
            onClick={() =>
              run(() => socialApi(path + "/" + photo.id, "DELETE"))
            }
          >
            Удалить фото
          </button>
          <button
            className="quiet"
            disabled={busy}
            onClick={() => setDeleting(false)}
          >
            Отмена
          </button>
        </div>
      ) : (
        <button
          className="quiet danger"
          onClick={() => setDeleting(true)}
          disabled={busy}
        >
          Удалить
        </button>
      )}
    </>
  );
}

// The existing thumbnail pipeline fits a square. Width descriptors use the
// actual output width (also for portraits), not the square's nominal size.
function variants(photo) {
  const widths = new Map();
  for (const size of [320, 640, 1280]) {
    const width = Math.max(
      1,
      Math.round(
        photo.width * Math.min(1, size / Math.max(photo.width, photo.height)),
      ),
    );
    if (!widths.has(width)) widths.set(width, photo.url + "?width=" + size);
  }
  return [...widths].map(([width, url]) => `${url} ${width}w`).join(", ");
}

export default function ComponentGallery({ model, user }) {
  const uploadLabel = useId(),
    uploadHint = useId();
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [file, setFile] = useState(null);
  const input = useRef(null),
    requests = useRef({ revision: 0 });
  const path = "components/" + model.id + "/photos";
  const viewerId = user?.id;
  const load = useCallback(async () => {
    const revision = ++requests.current.revision;
    try {
      const next = await socialApi(path);
      if (revision === requests.current.revision) {
        setData(next);
        setError("");
      }
    } catch (e) {
      if (revision === requests.current.revision) setError(e.message);
    }
  }, [path]);
  useEffect(() => {
    const pending = requests.current;
    void load();
    return () => {
      pending.revision++;
    };
  }, [load, viewerId]);
  async function run(action) {
    setBusy(true);
    setError("");
    try {
      await action();
      await load();
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const galleryEdit = (changes) =>
    run(() => socialApi(path, "PATCH", { version: data.version, ...changes }));
  function move(index, delta) {
    const order = data.photos.map((p) => p.id);
    [order[index], order[index + delta]] = [order[index + delta], order[index]];
    return galleryEdit({ order });
  }
  return (
    <section className={styles.gallery} aria-labelledby="component-photos">
      <div className="section-heading">
        <h2 id="component-photos">Фотографии компонента</h2>
        <span className="count">
          {data?.photos.filter((p) => !p.hidden && !p.unavailable).length || 0}
        </span>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
          <EmailPolicyAction message={error} />
          <button className="quiet" onClick={load} disabled={busy}>
            Обновить галерею
          </button>
        </p>
      )}
      {!data && !error && <p role="status">Загружаем фотографии…</p>}
      {data && !data.photos.length && (
        <p className="empty-state">
          Фотографий пока нет. Покажите, как выглядит эта модель.
        </p>
      )}
      <div className={styles.grid}>
        {data?.photos.map((photo, index) => (
          <figure
            className={styles.photo}
            id={"photo-" + photo.id}
            key={photo.id + ":" + photo.version}
          >
            <div className={styles.image}>
              <ZoomablePhoto
                src={photo.url}
                alt={photo.caption || model.name}
                srcSet={variants(photo)}
                sizes="(max-width: 700px) 100vw, (max-width: 1100px) 50vw, 400px"
              />
            </div>
            <figcaption>
              <div className={styles.actions}>
                {photo.isCover && <span className="badge">Обложка</span>}
                {photo.hidden && (
                  <span className="badge" data-tone="warning">
                    Скрыто
                  </span>
                )}
                {photo.unavailable && (
                  <span className="badge" data-tone="warning">
                    Автор заблокирован
                  </span>
                )}
              </div>
              {photo.caption && <p>{photo.caption}</p>}
              <p className="help">
                Фото:{" "}
                <Link href={profilePath(photo.author.username)}>
                  {personName(photo.author)}
                </Link>
              </p>
            </figcaption>
            <div className={styles.actions}>
              {photo.canEdit && (
                <PhotoActions photo={photo} run={run} busy={busy} path={path} />
              )}
              {photo.canReport && (
                <ReportButton
                  entityType="component_photo"
                  targetId={photo.id}
                  user={user}
                />
              )}
            </div>
            {data.canManage && (
              <div className={styles.actions}>
                {!photo.hidden && !photo.unavailable && !photo.isCover && (
                  <button
                    className="quiet"
                    disabled={busy}
                    onClick={() => galleryEdit({ coverId: photo.id })}
                  >
                    Сделать обложкой
                  </button>
                )}
                <button
                  className="quiet"
                  disabled={busy}
                  onClick={() =>
                    run(() =>
                      socialApi(path + "/" + photo.id, "PATCH", {
                        version: photo.version,
                        hidden: !photo.hidden,
                      }),
                    )
                  }
                >
                  {photo.hidden ? "Восстановить фото" : "Скрыть фото"}
                </button>
                <button
                  className="quiet"
                  disabled={
                    busy ||
                    photo.isCover ||
                    index === 0 ||
                    data.photos[index - 1]?.isCover
                  }
                  onClick={() => move(index, -1)}
                  aria-label="Переместить фото выше"
                >
                  Выше
                </button>
                <button
                  className="quiet"
                  disabled={
                    busy || photo.isCover || index === data.photos.length - 1
                  }
                  onClick={() => move(index, 1)}
                  aria-label="Переместить фото ниже"
                >
                  Ниже
                </button>
              </div>
            )}
          </figure>
        ))}
      </div>
      {data?.canUpload && (
        <form
          className={styles.upload}
          aria-label="Загрузка фото компонента"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!file) return;
            if (
              await run(async () => {
                const response = await fetch("/api/" + path, {
                  method: "POST",
                  headers: { "Content-Type": file.type },
                  body: file,
                });
                const result = await response.json();
                if (!response.ok)
                  throw new Error(result.error || "Не удалось загрузить фото");
              })
            ) {
              setFile(null);
              if (input.current) input.current.value = "";
            }
          }}
        >
          <label className="field">
            <span id={uploadLabel}>Ваше фото компонента</span>
            <input
              ref={input}
              type="file"
              aria-labelledby={uploadLabel}
              aria-describedby={uploadHint}
              accept="image/jpeg,image/png,image/webp"
              disabled={busy}
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
            <small id={uploadHint}>
              JPEG, PNG или WebP, до 10 МБ, минимум 600 × 400 px.
            </small>
          </label>
          <p className="help">
            Фото будет видно всем, даже если ваш велосипед приватный. Загружайте
            только снимки, которые вы вправе публиковать.
          </p>
          <button className="button secondary" disabled={busy || !file}>
            {busy ? "Сохраняем…" : "Опубликовать фото"}
          </button>
        </form>
      )}
      {data &&
        !data.canUpload &&
        (user ? (
          <p className="help">
            Добавлять фотографии могут администраторы и владельцы велосипеда с
            этой моделью компонента.
          </p>
        ) : (
          <Link className="text-link" href="/account">
            Войти, чтобы добавить своё фото
          </Link>
        ))}
    </section>
  );
}
