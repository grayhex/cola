"use client";
import Link from "next/link";
import { Heart, Lock, MessageCircle, Bike } from "./icons.jsx";
import Photo from "./bike-photo.jsx";
import { AuthorLink } from "./social-primitives.jsx";
import { useSite } from "./site-provider.jsx";
import { MicroMetrics } from "./compact-ui.jsx";
import { useBikeReaction } from "./use-bike-reaction.js";
import styles from "./bike-card.module.css";

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
  const href = "/b/" + b.share_id;
  const Open = ownerView && onOpen ? "button" : Link;
  const openProps =
    ownerView && onOpen ? { type: "button", onClick: onOpen } : { href };
  const facts = ownerView
    ? [
        catalog.categories[b.category],
        b.weight && `${Number(b.weight)} кг`,
        b.size,
        b.color,
      ].filter(Boolean)
    : b.weight
      ? [`${Number(b.weight)} кг`]
      : [];
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
      <div className={`card-info ${styles.info}`}>
        <div className={`card-identity-row ${styles.identity}`}>
          <h2>
            <Open {...openProps}>{title}</Open>
          </h2>
          {facts.length > 0 && (
            <div className={`card-facts ${styles.facts}`}>
              {facts.map((text, i) => (
                <span key={i}>{text}</span>
              ))}
            </div>
          )}
        </div>
        <div className={`card-social ${styles.social}`}>
          <AuthorLink author={b.author} />
          {b.is_public && (
            <div className={styles.stats}>
              <button
                type="button"
                className={`like-button ${styles.stat}`}
                disabled={b.is_owner}
                aria-label={
                  t("Нравится") +
                  (reaction.likes == null ? "" : ": " + reaction.likes)
                }
                aria-pressed={reaction.liked}
                aria-busy={reaction.pending}
                onClick={reaction.toggle}
              >
                <Heart
                  size={18}
                  fill={reaction.liked ? "currentColor" : "none"}
                />
                {reaction.likes != null && <span>{reaction.likes}</span>}
              </button>
              <Link
                className={styles.stat}
                href={href + "#discussion"}
                aria-label={
                  t("Комментарии") +
                  (b.comments == null ? "" : ": " + b.comments)
                }
              >
                <MessageCircle size={18} />
                {b.comments != null && <span>{b.comments}</span>}
              </Link>
            </div>
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
