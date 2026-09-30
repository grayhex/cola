"use client";
import type * as React from "react";
import type { BikeDto, ViewerDto } from "../../lib/contracts.ts";
import { BikeLabels, BikeLike } from "./bike-labels.tsx";
import Link from "next/link";
import { SharedView } from "./motion.tsx";
import { Lock, MessageCircle, Bike } from "./icons.tsx";
import Photo from "./bike-photo.tsx";
import { AuthorLink } from "./social-primitives.tsx";
import { useSite } from "./site-provider.tsx";
import { MicroMetrics } from "./compact-ui.tsx";
import { useBikeReaction } from "./use-bike-reaction.ts";
import styles from "./bike-card.module.css";
import { publicPath } from "../../lib/public-urls.ts";

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
}: {
  bike: BikeDto;
  onOpen?: () => void;
  user?: ViewerDto | null;
  onGuest?: () => void;
  ownerView?: boolean;
  headingLevel?: number;
  sizes?: string;
}) {
  const { t } = useSite();
  const reaction = useBikeReaction(b, user, onGuest);
  const title = b.name || [b.brand, b.model].filter(Boolean).join(" ");
  const href = publicPath("bike", b);
  const open = (children: React.ReactNode, photo = false) => {
    const props = photo
      ? {
          className: `card-open-photo ${styles.openPhoto}`,
          "aria-hidden": true as const,
          tabIndex: -1,
        }
      : {};
    return ownerView && onOpen ? (
      <button type="button" onClick={onOpen} {...props}>
        {children}
      </button>
    ) : (
      <Link href={href} {...props}>
        {children}
      </Link>
    );
  };
  const Heading = headingLevel === 3 ? "h3" : "h2";
  return (
    <article className={`bike-card ${styles.card}`} data-bike-id={b.id}>
      <div className={`card-photo ${styles.photo}`}>
        {open(
          <SharedView kind="bike-photo" id={b.id}>
            <Photo bike={b} sizes={sizes} />
          </SharedView>,
          true,
        )}
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
          <Heading>{open(title)}</Heading>
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
