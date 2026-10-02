"use client";
import type { BikeDto, PublicPhoto } from "../../../lib/contracts.ts";
import { SharedView } from "../motion.tsx";
import Photo from "../bike-photo.tsx";
import { Star, Trash2 } from "../icons.tsx";

// The picture column of the bike page (#291): one frame that always shows
// the whole bike, one row of thumbnails right under it. The owner manages
// the photo in the frame (cover, delete) instead of under every thumbnail.
export default function BikeGallery({
  bike,
  photo,
  thumbnails,
  editable,
  busy,
  t,
  onSelect,
  onOpen,
  onCover,
  onDelete,
  demoCredit,
}: {
  bike: BikeDto;
  photo: PublicPhoto | null;
  thumbnails: boolean;
  editable: boolean;
  busy: boolean;
  t: (text: string) => string;
  onSelect: (photo: PublicPhoto) => void;
  onOpen: () => void;
  onCover: (photo: PublicPhoto) => void;
  onDelete: (photo: PublicPhoto) => void;
  demoCredit: boolean;
}) {
  const position = Math.max(
    1,
    bike.photos.findIndex((p) => p.id === photo?.id) + 1,
  );
  return (
    <div className="bike-media">
      <div className="showcase">
        <div className="photo-stage">
          <span className="photo-index">
            {String(position).padStart(2, "0")} /{" "}
            {String(Math.max(1, bike.photos.length)).padStart(2, "0")}
          </span>
          <button type="button" className="photo-open" onClick={onOpen}>
            {/* The photo's description (or the placeholder text) ends the
                name, so the visible text is part of it (#119). */}
            <span className="visually-hidden">
              {t("Открыть фото целиком")}:{" "}
            </span>
            <SharedView kind="bike-photo" id={bike.id}>
              <Photo
                bike={bike}
                photo={photo}
                className="hero-photo"
                sizes="(max-width: 900px) 100vw, 50vw"
                priority
              />
            </SharedView>
          </button>
          {photo?.source_page_url && (
            <a
              className="photo-credit"
              href={photo.source_page_url}
              target="_blank"
              rel="noreferrer"
            >
              Источник фотографии
            </a>
          )}
          {demoCredit && (
            <a
              className="photo-credit"
              href="https://www.canyon.com/en-si/outlet-bikes/gravel-bikes/grizl-al-7-raw/50051247.html"
              target="_blank"
              rel="noreferrer"
            >
              {t("Фото: Canyon · пример сборки")}
            </a>
          )}
          {editable && photo && (
            <div
              className="photo-tools"
              role="group"
              aria-label={t("Эта фотография")}
            >
              <button
                type="button"
                disabled={busy || photo.is_cover}
                onClick={() => onCover(photo)}
              >
                <Star size={14} aria-hidden="true" />
                {photo.is_cover ? t("Обложка") : t("На обложку")}
              </button>
              <button
                type="button"
                className="danger"
                aria-label={t("Удалить фото")}
                title={t("Удалить фото")}
                onClick={() => onDelete(photo)}
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      </div>
      {thumbnails && bike.photos.length > 1 && (
        <ul className="gallery" aria-label={t("Фотографии")}>
          {bike.photos.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className={"thumb" + (photo?.id === p.id ? " active" : "")}
                aria-label={t("Показать фотографию")}
                aria-current={photo?.id === p.id ? "true" : undefined}
                onClick={() => onSelect(p)}
              >
                <Photo bike={bike} photo={p} sizes="160px" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
