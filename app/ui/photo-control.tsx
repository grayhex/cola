"use client";
import NavPopover from "./nav-popover.tsx";
import SiteIcon from "./site-icon.tsx";
import { ChevronDown, Eraser, Star, Trash2, Undo2 } from "./icons.tsx";
import styles from "./photo-control.module.css";

// The one place for the photos of a bike (#370): the bike page and the wizard
// both use it. Adding is always there, even with an empty gallery; the rest
// acts on the photo that is selected, and the control says which one. The
// cover and delete buttons no longer sit on the picture itself.
export type PhotoControlTarget = {
  /** 1-based place of the selected photo among `total`. */
  position: number;
  total: number;
  /** The selected photo is the cover now. */
  isCover: boolean;
  /** Its backdrop was taken off and the version before is kept (#370). */
  hasOriginal?: boolean;
};
export default function PhotoControl({
  selected,
  busy = false,
  coverLocked = false,
  onAdd,
  onCover,
  onDelete,
  onRemoveBackground,
  onRestoreOriginal,
  t = (text) => text,
}: {
  /** The selected photo; null when there is none, and then only adding works. */
  selected: PhotoControlTarget | null;
  busy?: boolean;
  /** The cover was already decided (the wizard is saving): it cannot move here. */
  coverLocked?: boolean;
  onAdd: () => void;
  onCover: () => void;
  onDelete: () => void;
  /** Present only where a photo can be cleared of its background. */
  onRemoveBackground?: () => void;
  /** Present where the version before the removal is kept: it brings it back. */
  onRestoreOriginal?: () => void;
  t?: (text: string) => string;
}) {
  const where = selected
    ? `${t("Фото")} ${selected.position} ${t("из")} ${selected.total}`
    : "";
  return (
    <div
      className={styles.control}
      role="group"
      aria-label={t("Фотографии велосипеда")}
      data-photo-control
    >
      <button
        type="button"
        className={styles.add}
        disabled={busy}
        onClick={onAdd}
      >
        <SiteIcon name="addPhoto" size={15} />
        <span>{t("Добавить фото")}</span>
      </button>
      {selected ? (
        <NavPopover
          label={`${where}${selected.isCover ? ", " + t("обложка") : ""}: ${t("действия")}`}
          className={styles.menu}
          trigger={
            <>
              <span>{where}</span>
              {selected.isCover && (
                <strong className={styles.mark}>{t("Обложка")}</strong>
              )}
              <ChevronDown size={14} aria-hidden="true" />
            </>
          }
        >
          <button
            type="button"
            className="nav-menu-link"
            disabled={busy || selected.isCover || coverLocked}
            onClick={onCover}
          >
            <Star size={15} aria-hidden="true" />
            <span>
              {selected.isCover
                ? t("Это обложка")
                : coverLocked
                  ? t("Обложка выбрана при сохранении")
                  : t("Сделать обложкой")}
            </span>
          </button>
          {selected.hasOriginal && onRestoreOriginal ? (
            <button
              type="button"
              className="nav-menu-link"
              disabled={busy}
              onClick={onRestoreOriginal}
            >
              <Undo2 size={15} aria-hidden="true" />
              <span>{t("Вернуть исходное фото")}</span>
            </button>
          ) : (
            onRemoveBackground && (
              <button
                type="button"
                className="nav-menu-link"
                disabled={busy}
                onClick={onRemoveBackground}
              >
                <Eraser size={15} aria-hidden="true" />
                <span>{t("Удалить фон")}</span>
              </button>
            )
          )}
          <button
            type="button"
            className={`nav-menu-link ${styles.danger}`}
            disabled={busy}
            onClick={onDelete}
          >
            <Trash2 size={15} aria-hidden="true" />
            <span>{t("Удалить фото")}</span>
          </button>
        </NavPopover>
      ) : (
        <button
          type="button"
          className={styles.idle}
          disabled
          aria-label={t("Действия с фото недоступны: нет фотографии")}
        >
          <span>{t("Нет фото")}</span>
        </button>
      )}
    </div>
  );
}
