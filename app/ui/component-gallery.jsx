"use client";
import Image from "next/image";
import Link from "next/link";
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  Upload,
  Settings2,
  Star,
  EyeOff,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { CompactDialog } from "./compact-ui.tsx";
import { usePhotoCarousel } from "./use-photo-carousel.ts";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import ZoomablePhoto from "./zoomable-photo.tsx";
import { socialApi } from "./social-primitives.tsx";
import { ReportButton } from "./community-controls.jsx";
import EmailPolicyAction from "./email-policy-action.tsx";
import { profilePath } from "../../lib/public-urls.ts";
import { personName } from "../../lib/usernames.ts";
import styles from "./component-gallery.module.css";
import ComponentPhotoSearch, {
  PhotoSource,
} from "./component-photo-search.jsx";

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

/**
 * The component's photos with its action row (#264). `leading` goes first in
 * the row (the model's own edit); `children` is the column beside the photos.
 */
export default function ComponentGallery({
  model,
  user,
  leading = null,
  children = null,
}) {
  const uploadLabel = useId(),
    uploadHint = useId();
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [file, setFile] = useState(null);
  const [uploadOpen, setUploadOpen] = useState(false),
    [manageOpen, setManageOpen] = useState(false);
  const photos = data?.photos || [];
  const {
    rail,
    active,
    move: selectPhoto,
    events,
  } = usePhotoCarousel(photos.length);
  const photo = photos[active];
  const thumbnails = useRef(null);
  const railId = useId();
  useEffect(() => {
    const node = thumbnails.current;
    const thumb = node?.children[active];
    if (thumb)
      node.scrollLeft =
        thumb.offsetLeft - node.clientWidth / 2 + thumb.clientWidth / 2;
  }, [active]);
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
  const manageable =
    photo && (photo.canEdit || data.canManage || photo.canReport);
  return (
    <>
      {/* One row of small buttons above the divider (#264): editing the
          model first (`leading`), then finding, uploading and managing photos. */}
      <div className={styles.toolbar}>
        <div
          className={styles.toolbarRow}
          role="group"
          aria-label="Действия с компонентом"
        >
          {leading}
          {data?.canSearch && (
            <ComponentPhotoSearch
              key={model.id + ":" + viewerId}
              model={model}
              onSaved={load}
            />
          )}
          {data?.canUpload && (
            <button
              className="button secondary small"
              type="button"
              aria-haspopup="dialog"
              aria-expanded={uploadOpen}
              onClick={(e) => {
                e.currentTarget.focus();
                setUploadOpen(true);
              }}
            >
              <Upload size={16} />
              Загрузить фото
            </button>
          )}
          {manageable && (
            <button
              className="button secondary small"
              type="button"
              aria-haspopup="dialog"
              aria-expanded={manageOpen}
              onClick={() => setManageOpen(true)}
            >
              <Settings2 size={16} />
              Управление фото
            </button>
          )}
        </div>
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
      {/* The description on the left, the photos on the right (#264). */}
      <div className={styles.workspace}>
        {children}
        <section className={styles.gallery} aria-labelledby="component-photos">
          <div className="section-heading">
            <h2 id="component-photos">Фотографии компонента</h2>
            <span className="count">
              {photos.filter((p) => !p.hidden && !p.unavailable).length}
            </span>
          </div>
          <div className={styles.visual}>
            {!data && !error && (
              <div className={styles.placeholder} role="status">
                <Camera size={48} />
                Загружаем фотографии…
              </div>
            )}
            {data && !photos.length && (
              <div className={styles.placeholder}>
                <Camera size={48} />
                <p>Фотографий пока нет. Покажите, как выглядит эта модель.</p>
              </div>
            )}
            {!!photos.length && (
              <>
                <div
                  ref={rail}
                  id={railId}
                  className={styles.rail}
                  tabIndex={0}
                  role="region"
                  aria-roledescription="карусель"
                  aria-label="Фото компонента; стрелки, Home и End для выбора"
                  {...events}
                >
                  {photos.map((p, index) => (
                    <figure
                      className={styles.slide}
                      id={"photo-" + p.id}
                      key={p.id}
                      inert={index !== active}
                      aria-hidden={index !== active}
                    >
                      <div className={styles.image}>
                        <ZoomablePhoto
                          src={p.url}
                          alt={p.caption || model.name}
                          srcSet={variants(p)}
                          sizes="(max-width: 800px) 100vw, 800px"
                        />
                      </div>
                      <figcaption>
                        <span>{p.caption || model.name}</span>
                        {p.isCover && <span className="badge">Обложка</span>}
                        {p.hidden && (
                          <span className="badge" data-tone="warning">
                            Скрыто
                          </span>
                        )}
                        {p.unavailable && (
                          <span className="badge" data-tone="warning">
                            Автор заблокирован
                          </span>
                        )}
                      </figcaption>
                    </figure>
                  ))}
                </div>
                <div className={styles.controls}>
                  <button
                    type="button"
                    className="icon"
                    aria-label="Предыдущее фото компонента"
                    aria-controls={railId}
                    disabled={active === 0}
                    onClick={() => selectPhoto(active - 1)}
                  >
                    <ChevronLeft size={20} />
                  </button>
                  <input
                    type="range"
                    min="1"
                    max={photos.length}
                    step="1"
                    value={active + 1}
                    disabled={photos.length < 2}
                    aria-label="Выбор фото компонента"
                    aria-valuetext={`Фото ${active + 1} из ${photos.length}`}
                    aria-controls={railId}
                    onChange={(e) =>
                      selectPhoto(Number(e.target.value) - 1, false)
                    }
                  />
                  <output aria-live="polite" aria-atomic="true">
                    {active + 1} / {photos.length}
                  </output>
                  <button
                    type="button"
                    className="icon"
                    aria-label="Следующее фото компонента"
                    aria-controls={railId}
                    disabled={active === photos.length - 1}
                    onClick={() => selectPhoto(active + 1)}
                  >
                    <ChevronRight size={20} />
                  </button>
                </div>
                {photos.length > 1 && (
                  <nav
                    ref={thumbnails}
                    className={styles.thumbnails}
                    aria-label="Миниатюры фотографий"
                  >
                    {photos.map((p, index) => (
                      <button
                        type="button"
                        key={p.id}
                        aria-label={`Показать фото ${index + 1}: ${p.caption || model.name}`}
                        aria-current={index === active ? "true" : undefined}
                        onClick={() => selectPhoto(index)}
                      >
                        <Image
                          width={p.width}
                          height={p.height}
                          unoptimized
                          src={p.url + "?width=320"}
                          alt=""
                          loading="lazy"
                          decoding="async"
                        />
                        <span>{index + 1}</span>
                      </button>
                    ))}
                  </nav>
                )}
              </>
            )}
          </div>
          {photo && (
            <div className={styles.photoInfo} key={photo.id}>
              <p className="help">
                {photo.source ? "Добавил:" : "Фото:"}{" "}
                <Link href={profilePath(photo.author.username)}>
                  {personName(photo.author)}
                </Link>
              </p>
              <PhotoSource source={photo.source} />
            </div>
          )}
          {data &&
            !data.canUpload &&
            (user ? (
              <p className="help">
                Добавлять фотографии могут администраторы и владельцы велосипеда
                с этой моделью компонента.
              </p>
            ) : (
              <Link className="text-link" href="/account">
                Войти, чтобы добавить своё фото
              </Link>
            ))}
        </section>
      </div>
      {manageable && (
        <CompactDialog
          open={manageOpen}
          onClose={() => setManageOpen(false)}
          title="Управление фото"
          className={styles.photoDialog}
        >
          {manageOpen && (
            <div className={styles.management}>
              <p className="help">
                Фото {active + 1} из {photos.length}:{" "}
                {photo.caption || model.name}
              </p>
              <div className={styles.actions}>
                {photo.canEdit && (
                  <PhotoActions
                    key={photo.id + ":" + photo.version}
                    photo={photo}
                    run={run}
                    busy={busy}
                    path={path}
                  />
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
                      <Star size={16} />
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
                    <EyeOff size={16} />
                    {photo.hidden ? "Восстановить фото" : "Скрыть фото"}
                  </button>
                  <button
                    className="quiet"
                    disabled={
                      busy ||
                      photo.isCover ||
                      active === 0 ||
                      photos[active - 1]?.isCover
                    }
                    onClick={() => move(active, -1)}
                    aria-label="Переместить фото выше"
                  >
                    <ArrowUp size={16} />
                    Выше
                  </button>
                  <button
                    className="quiet"
                    disabled={
                      busy || photo.isCover || active === photos.length - 1
                    }
                    onClick={() => move(active, 1)}
                    aria-label="Переместить фото ниже"
                  >
                    <ArrowDown size={16} />
                    Ниже
                  </button>
                </div>
              )}
            </div>
          )}
        </CompactDialog>
      )}
      {data?.canUpload && (
        <CompactDialog
          open={uploadOpen}
          onClose={() => {
            setUploadOpen(false);
            setFile(null);
          }}
          title="Загрузить фото компонента"
          className={styles.photoDialog}
        >
          {uploadOpen && (
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
                      throw new Error(
                        result.error || "Не удалось загрузить фото",
                      );
                  })
                ) {
                  setFile(null);
                  if (input.current) input.current.value = "";
                  setUploadOpen(false);
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
                Фото будет видно всем, даже если ваш велосипед приватный.
                Загружайте только снимки, которые вы вправе публиковать.
              </p>
              {error && (
                <p className="error" role="alert">
                  {error}
                  <EmailPolicyAction message={error} />
                </p>
              )}
              <button className="button secondary" disabled={busy || !file}>
                {busy ? "Сохраняем…" : "Опубликовать фото"}
              </button>
            </form>
          )}
        </CompactDialog>
      )}
    </>
  );
}
