"use client";
import { BikeLabels, BikeLike } from "./bike-labels.jsx";
import Link from "next/link";
import { Lock, MessageCircle, Bike } from "./icons.jsx";
import Photo from "./bike-photo.jsx";
import { AuthorLink } from "./social-primitives.jsx";
import { useSite } from "./site-provider.jsx";
import { MicroMetrics } from "./compact-ui.jsx";
import { useBikeReaction } from "./use-bike-reaction.js";
import styles from "./bike-card.module.css";
import { publicPath } from "../../lib/public-urls.js";

// Photo-first card with a Datasets-style body (#127): the name, a row of
// labels, then the owner and the counters in one quiet line.
export default function BikeCard({
  bike: b,
  onOpen,
  user,
  onGuest,
  ownerView = false,
  headingLevel = 2,
  sizes,
}) {
  const { t } = useSite();
  const reaction = useBikeReaction(b, user, onGuest);
  const title = b.name || [b.brand, b.model].filter(Boolean).join(" ");
  const href = publicPath("bike", b);
  const Open = ownerView && onOpen ? "button" : Link;
  const openProps =
    ownerView && onOpen ? { type: "button", onClick: onOpen } : { href };
  const Heading = headingLevel === 3 ? "h3" : "h2";
  return (
    <article className={`bike-card ${styles.card}`} data-bike-id={b.id}>
      <div className={`card-photo ${styles.photo}`}>
        <Open
          {...openProps}
          className={`card-open-photo ${styles.openPhoto}`}
          // The title link opens the same page; this one is for the mouse.
          aria-hidden="true"
          tabIndex={-1}
        >
          <Photo bike={b} sizes={sizes} />
        </Open>
        {ownerView && !b.is_public && (
          <span
            className={styles.private}
            role="img"
            aria-label={t("Личный велосипед")}
          >
            <Lock size={14} />
          </span>
        )}
      </div>
      <div className={`card-info ${styles.info}`}>
        <div className={`card-identity-row ${styles.identity}`}>
          <Heading>
            <Open {...openProps}>{title}</Open>
          </Heading>
        </div>
        <BikeLabels bike={b} />
        <div className={`card-social ${styles.social}`}>
          <AuthorLink author={b.author} />
          {b.is_public && (
            <span className={styles.counters}>
              <BikeLike bike={b} reaction={reaction} t={t} compact />
              <Link
                className={styles.stat}
                data-hover="comment"
                href={href + "#discussion"}
                aria-label={
                  t("Комментарии") +
                  (b.comments == null ? "" : ": " + b.comments)
                }
              >
                <MessageCircle size={14} aria-hidden="true" />
                {b.comments != null && <span>{b.comments}</span>}
              </Link>
            </span>
          )}
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
                <Bike size={16} aria-hidden="true" />
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
