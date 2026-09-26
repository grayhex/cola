"use client";
import { useId } from "react";
import { BikeLike } from "./bike-labels.jsx";
import BikeFollow from "./bike-follow.jsx";
import ShareButton from "./share-button.jsx";
import {
  MessageCircle,
  ImagePlus,
  Search,
  Globe,
  Lock,
  Pencil,
  Trash2,
} from "./icons.jsx";
import { publicPath } from "../../lib/public-urls.js";
import styles from "./bike-actions.module.css";

// Everything a reader and the owner can do with a bike, in one place (#121):
// small labelled buttons under the photo, with counts in their own segment,
// instead of icons over the photo and next to the title.
export default function BikeActions({
  bike,
  title,
  editable,
  reaction,
  busy,
  onAddPhoto,
  onFindPhoto,
  onAccess,
  onEdit,
  onDelete,
  t = (s) => s,
}) {
  const accessId = useId();
  if (!bike.is_public && !editable) return null;
  return (
    <div className={`bike-actions ${styles.bar}`} data-bike-actions>
      {bike.is_public && (
        <div className={styles.group} role="group" aria-label={t("Реакции")}>
          <BikeLike bike={bike} reaction={reaction} t={t} />
          {!bike.is_owner && (
            <BikeFollow
              bikeId={bike.id}
              className={`${styles.action} ${styles.iconOnly}`}
            />
          )}
          <a className={styles.action} data-hover="comment" href="#discussion">
            <MessageCircle size={15} aria-hidden="true" />
            <span>{t("Обсуждение")}</span>
            {bike.comments != null && (
              <strong className={styles.count}>{bike.comments}</strong>
            )}
          </a>
          <ShareButton
            path={publicPath("bike", bike)}
            title={title}
            className={styles.share}
          />
          {reaction.error && (
            <p role="alert" className={styles.alert}>
              {t("Лайк не сохранился. Попробуй ещё раз")}
            </p>
          )}
        </div>
      )}
      {editable && (
        <div
          className={styles.group}
          role="group"
          aria-label={t("Управление велосипедом")}
        >
          <button
            type="button"
            className={`${styles.action} ${styles.iconOnly}`}
            title={t("Добавить фото")}
            disabled={busy}
            onClick={onAddPhoto}
          >
            <ImagePlus size={15} aria-hidden="true" />
            <span>{t("Добавить фото")}</span>
          </button>
          <button
            type="button"
            className={`${styles.action} ${styles.iconOnly}`}
            title={t("Найти фото")}
            onClick={onFindPhoto}
          >
            <Search size={15} aria-hidden="true" />
            <span>{t("Найти фото")}</span>
          </button>
          <button
            type="button"
            className={styles.action}
            aria-describedby={accessId}
            title={t("Кто видит велосипед")}
            onClick={onAccess}
          >
            {bike.is_public ? (
              <Globe size={15} aria-hidden="true" />
            ) : (
              <Lock size={15} aria-hidden="true" />
            )}
            <span>{t("Доступ")}</span>
            <strong className={styles.count} id={accessId} aria-hidden="true">
              {bike.is_public ? t("Все") : t("Только вы")}
            </strong>
          </button>
          <button
            type="button"
            className={`${styles.action} ${styles.iconOnly}`}
            title={t("Редактировать")}
            onClick={onEdit}
          >
            <Pencil size={15} aria-hidden="true" />
            <span>{t("Редактировать")}</span>
          </button>
          <button
            type="button"
            className={`${styles.action} ${styles.iconOnly} ${styles.danger}`}
            title={t("Удалить")}
            onClick={onDelete}
          >
            <Trash2 size={15} aria-hidden="true" />
            <span>{t("Удалить")}</span>
          </button>
        </div>
      )}
    </div>
  );
}
