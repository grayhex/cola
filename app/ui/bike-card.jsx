"use client";
import { BikeLabels, BikeLike } from "./bike-labels.jsx";
import { PhotoActions } from "./content-label.jsx";
import Link from "next/link";
import { Lock, MessageCircle, Bike } from "./icons.jsx";
import Photo from "./bike-photo.jsx";
import { AuthorLink } from "./social-primitives.jsx";
import { useSite } from "./site-provider.jsx";
import { MicroMetrics } from "./compact-ui.jsx";
import { useBikeReaction } from "./use-bike-reaction.js";
import styles from "./bike-card.module.css";
import { publicPath } from "../../lib/public-urls.js";

export default function BikeCard({
  bike: b,
  onOpen,
  user,
  onGuest,
  ownerView = false,
}) {
  const { catalog, personalSettings: settings, t } = useSite();
  const reaction = useBikeReaction(b, user, onGuest);
  const title = b.name || [b.brand, b.model].filter(Boolean).join(" ");
  const href = publicPath("bike", b);
  const Open = ownerView && onOpen ? "button" : Link;
  const openProps =
    ownerView && onOpen ? { type: "button", onClick: onOpen } : { href };
  return (
    <article className={`bike-card ${styles.card}`} data-bike-id={b.id}>
      <div className={`card-photo ${styles.photo}`}>
        <Open
          {...openProps}
          className={`card-open-photo ${styles.openPhoto}`}
          aria-label={t("Открыть") + " " + title}
        >
          <Photo bike={b} />
        </Open>
        {ownerView && !b.is_public && (
          <span className={styles.private} aria-label={t("Личный велосипед")}>
            <Lock size={14} />
          </span>
        )}
      </div>
      {b.is_public && (
        <PhotoActions>
          <BikeLike bike={b} reaction={reaction} t={t} />
          <Link
            className={styles.stat}
            href={href + "#discussion"}
            aria-label={t("Комментарии") + (b.comments == null ? "" : ": " + b.comments)}
          >
            <MessageCircle size={18} />
            {b.comments != null && <span>{b.comments}</span>}
          </Link>
        </PhotoActions>
      )}
      <div className={`card-info ${styles.info}`}>
        <div className={`card-identity-row ${styles.identity}`}>
          <h2>
            <Open {...openProps}>{title}</Open>
          </h2>
        </div>
        <BikeLabels bike={b} />
        <div className={`card-social ${styles.social}`}>
          <AuthorLink author={b.author} />
        </div>
        {ownerView && (
          <div className={styles.ownerSignals}>
            <MicroMetrics scores={b.scores} />
            {b.is_public && (
              <Link
                className={styles.stat}
                href={"/search?similar=" + b.id}
                aria-label={t("Похожие сборки")}
              >
                <Bike size={18} />
              </Link>
            )}
          </div>
        )}
      </div>
      {reaction.error && (
        <p className={styles.error} role="alert">
          {t("Лайк не сохранился. Попробуй ещё раз")}
        </p>
      )}
    </article>
  );
}
