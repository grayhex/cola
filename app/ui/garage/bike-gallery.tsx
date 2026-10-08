"use client";
import type { BikeDto, PublicPhoto } from "../../../lib/contracts.ts";
import { SharedView } from "../motion.tsx";
import type { PhotoProblem } from "../../../lib/photo-upload.ts";
import Photo from "../bike-photo.tsx";
import PhotoControl from "../photo-control.tsx";
import PhotoProblems from "../photo-problems.tsx";

// The picture column of the bike page (#291): one frame that always shows
// the whole bike, one row of thumbnails right under it. The owner manages the
// photos with one control under the picture (#370): add, make the cover,
// delete — nothing sits on the photograph but the passive mark of the cover.
// The control stays when the layout hides the picture itself: it is the one
// way to add a photo.
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
  onAdd,
  problems = [],
  onDismissProblems,
  showPicture = true,
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
  onAdd: () => void;
  /** Files the site refused, told about beside the control that took them. */
  problems?: PhotoProblem[];
  onDismissProblems?: () => void;
  /** The layout may hide the picture and the thumbnails; the control stays. */
  showPicture?: boolean;
  demoCredit: boolean;
}) {
  const position = Math.max(
    1,
    bike.photos.findIndex((p) => p.id === photo?.id) + 1,
  );
  return (
    <div className="bike-media">
      {showPicture && (
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
            {editable && photo?.is_cover && bike.photos.length > 1 && (
              <span className="photo-cover-mark">{t("Обложка")}</span>
            )}
          </div>
        </div>
      )}
      {showPicture && thumbnails && bike.photos.length > 1 && (
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
      {editable && (
        <>
          <PhotoControl
            selected={
              photo
                ? {
                    position,
                    total: bike.photos.length,
                    isCover: photo.is_cover,
                  }
                : null
            }
            busy={busy}
            onAdd={onAdd}
            onCover={() => photo && onCover(photo)}
            onDelete={() => photo && onDelete(photo)}
            t={t}
          />
          {onDismissProblems && (
            <PhotoProblems problems={problems} onDismiss={onDismissProblems} />
          )}
        </>
      )}
    </div>
  );
}
