"use client";
import type { BikeDto } from "../../lib/contracts.ts";
import type { useBikeReaction } from "./use-bike-reaction.ts";
import { useId } from "react";
import NavPopover from "./nav-popover.tsx";
import { BikeLike } from "./bike-labels.tsx";
import BikeFollow from "./bike-follow.tsx";
import ShareButton from "./share-button.tsx";
import { Search, Trash2, Ellipsis } from "./icons.tsx";
import SiteIcon from "./site-icon.tsx";
import { publicPath } from "../../lib/public-urls.ts";
import styles from "./bike-actions.module.css";

// Shared callbacks, separate owner and social rows on the detail page (#291).
// The comments link of the first design is the «Комментарии» figure now.
export default function BikeActions({
  bike,
  title,
  editable,
  reaction,
  onFindPhoto,
  onAccess,
  onEdit,
  onDelete,
  t = (s) => s,
  section,
}: {
  section: "owner" | "social";
  bike: BikeDto;
  title: string;
  editable: boolean;
  reaction: ReturnType<typeof useBikeReaction>;
  onFindPhoto: () => void;
  onAccess: () => void;
  onEdit: () => void;
  onDelete: () => void;
  t?: (text: string) => string;
}) {
  const accessId = useId();
  if (section === "owner" ? !editable : !bike.is_public) return null;
  return (
    <div className={`bike-actions ${styles.bar}`} data-bike-actions={section}>
      {section === "social" && bike.is_public && (
        <div
          className={`${styles.group} ${styles.social}`}
          role="group"
          aria-label={t("Реакции")}
        >
          <BikeLike bike={bike} reaction={reaction} t={t} showCount={false} />
          {!bike.is_owner && (
            <BikeFollow
              bikeId={bike.id}
              className={`${styles.action} ${styles.primary}`}
            />
          )}
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
      {section === "owner" && editable && (
        <div
          className={styles.group}
          role="group"
          aria-label={t("Управление велосипедом")}
        >
          <button
            type="button"
            className={styles.action}
            title={t("Редактировать")}
            onClick={onEdit}
          >
            <SiteIcon name="edit" size={15} />
            <span>{t("Редактировать")}</span>
          </button>
          <button
            type="button"
            className={styles.action}
            aria-describedby={accessId}
            title={t("Кто видит велосипед")}
            onClick={onAccess}
          >
            <SiteIcon name={bike.is_public ? "public" : "private"} size={15} />
            <span>{t("Приватность")}</span>
            <strong className={styles.count} id={accessId} aria-hidden="true">
              {bike.is_public ? t("Все") : t("Только вы")}
            </strong>
          </button>
          <NavPopover
            label={t("Ещё")}
            className={styles.more}
            trigger={
              <>
                <Ellipsis size={15} aria-hidden="true" />
                <span>{t("Ещё")}</span>
              </>
            }
          >
            <button
              type="button"
              className="nav-menu-link"
              onClick={onFindPhoto}
            >
              <Search size={15} aria-hidden="true" />
              <span>{t("Найти фото")}</span>
            </button>
            <button
              type="button"
              className={`nav-menu-link ${styles.danger}`}
              onClick={onDelete}
            >
              <Trash2 size={15} aria-hidden="true" />
              <span>{t("Удалить")}</span>
            </button>
          </NavPopover>
        </div>
      )}
    </div>
  );
}
