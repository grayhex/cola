"use client";
import type {
  ComponentGalleryDto,
  PartLandingDto,
} from "../../lib/contracts.ts";
import type { searchComponentPhotos } from "../../lib/component-photo-search.ts";
type Candidates = Awaited<ReturnType<typeof searchComponentPhotos>>;

import { errorMessage } from "../../lib/errors.ts";
import { useId, useState } from "react";
import Image from "next/image";
import { Search } from "lucide-react";
import { CompactDialog } from "./compact-ui.tsx";
import { socialApi } from "./social-primitives.tsx";
import EmailPolicyAction from "./email-policy-action.tsx";
import styles from "./component-gallery.module.css";

export function PhotoSource({
  source,
}: {
  source: ComponentGalleryDto["photos"][number]["source"];
}) {
  if (!source) return null;
  return (
    <div className={styles.source}>
      <a href={source.url} target="_blank" rel="noopener noreferrer">
        {source.provider}: {source.title}
      </a>
      <span>Автор: {source.creator}</span>
      {source.credit && <span>{source.credit}</span>}
      <a href={source.licenseUrl} target="_blank" rel="noopener noreferrer">
        {source.license}
      </a>
      <span>Для сайта: WebP, изменение размера, удаление метаданных.</span>
    </div>
  );
}
export default function ComponentPhotoSearch({
  model,
  onSaved,
}: {
  model: Pick<PartLandingDto, "id" | "category" | "brand" | "name">;
  onSaved: () => Promise<void>;
}) {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [photos, setPhotos] = useState<Candidates["photos"] | null>(null),
    [selected, setSelected] = useState<string[]>([]),
    [unavailable, setUnavailable] = useState<string[]>([]),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const path = "components/" + model.id;
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const search = () =>
    run(async () => {
      setPhotos(null);
      setSelected([]);
      setUnavailable([]);
      setConfirmed(false);
      const result = await socialApi<Candidates>(
        path + "/photo-search",
        "POST",
        {},
      );
      setPhotos(result.photos);
    });
  return (
    <>
      <button
        className="button secondary small"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(e) => {
          e.currentTarget.focus();
          setOpen(true);
          if (!photos && !busy) void search();
        }}
      >
        <Search size={16} />
        Найти фото
      </button>
      <CompactDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Найти фото компонента"
        className={styles.photoDialog}
      >
        {open && (
          <section className={styles.search} aria-labelledby={titleId}>
            <h3 id={titleId}>Найти фото модели</h3>
            <p className="help">
              Поиск в Wikimedia Commons: {model.category} · {model.brand}{" "}
              {model.name}. Фотографии есть не для всех моделей. Проверьте
              соответствие и условия публикации — найденное не добавляется
              автоматически.
            </p>
            <button
              className="button secondary"
              type="button"
              disabled={busy}
              onClick={search}
            >
              {busy ? "Загрузка…" : "Повторить поиск"}
            </button>
            {busy && <p role="status">Ищем или сохраняем фотографии…</p>}
            {error && (
              <p className="error" role="alert">
                {error}
                <EmailPolicyAction message={error} />
              </p>
            )}
            {photos?.length === 0 && (
              <p role="status">
                Поиск не нашёл фото этой модели с поддерживаемой лицензией и
                достаточным разрешением. В Commons есть не все компоненты. Можно
                загрузить своё фото, если вам доступна ручная загрузка.
              </p>
            )}
            {(error || photos?.length === 0) && (
              <a
                href={
                  "https://commons.wikimedia.org/w/index.php?title=Special:MediaSearch&type=image&search=" +
                  encodeURIComponent(
                    [model.brand, model.name].filter(Boolean).join(" "),
                  )
                }
                target="_blank"
                rel="noopener noreferrer"
              >
                Открыть поиск в Commons и уточнить запрос
              </a>
            )}
            {!!photos?.length && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    await socialApi(path + "/photos/import", "POST", {
                      ids: selected,
                      confirmed,
                    });
                    setPhotos(null);
                    setSelected([]);
                    setConfirmed(false);
                    setOpen(false);
                    await onSaved();
                  });
                }}
              >
                <fieldset disabled={busy} className={styles.candidates}>
                  <legend>Выберите до трёх фотографий</legend>
                  <div className={styles.grid}>
                    {photos.map((p) => (
                      <div className={styles.photo} key={p.id}>
                        <label className={styles.candidate}>
                          <input
                            type="checkbox"
                            checked={selected.includes(p.id)}
                            disabled={
                              unavailable.includes(p.id) ||
                              (!selected.includes(p.id) && selected.length >= 3)
                            }
                            onChange={(e) => {
                              setSelected((v) =>
                                e.target.checked
                                  ? [...v, p.id]
                                  : v.filter((id) => id !== p.id),
                              );
                              setConfirmed(false);
                            }}
                          />
                          <span>Выбрать: {p.source.title}</span>
                          <Image
                            unoptimized
                            width={600}
                            height={400}
                            src={"/api/" + path + "/photo-candidates/" + p.id}
                            alt={p.source.title}
                            onError={() => {
                              setUnavailable((v) =>
                                v.includes(p.id) ? v : [...v, p.id],
                              );
                              setSelected((v) => v.filter((id) => id !== p.id));
                            }}
                          />
                        </label>
                        {unavailable.includes(p.id) && (
                          <p className="help">
                            Фото недоступно — повторите поиск позже.
                          </p>
                        )}
                        <PhotoSource source={p.source} />
                      </div>
                    ))}
                  </div>
                  <label className={styles.confirmation}>
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />
                    <span>
                      Я проверил модель, источник и лицензию выбранных фото и
                      подтверждаю, что могу опубликовать их с указанным
                      авторством и условиями лицензии.
                    </span>
                  </label>
                  <button
                    className="button"
                    disabled={!confirmed || !selected.length}
                  >
                    Опубликовать выбранные · {selected.length}/3
                  </button>
                </fieldset>
              </form>
            )}
          </section>
        )}
      </CompactDialog>
    </>
  );
}
