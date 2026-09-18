"use client";
import { Heart, Lock } from "lucide-react";
import Photo from "./bike-photo.jsx";
import BikeCategoryIcon from "./bike-category-icon.jsx";
import BikeMeters from "./bike-meters.jsx";
import { AuthorLink } from "./social-primitives.jsx";
import { useSite } from "./site-provider.jsx";
export default function BikeCard({
  bike: b,
  onOpen,
  onLike,
  busy = false,
  ownerView = false,
}) {
  const { catalog } = useSite();
  const open = onOpen || (() => window.location.assign("/b/" + b.share_id));
  return (
    <article className="bike-card">
      <div className="card-photo">
        <button
          className="card-open-photo"
          type="button"
          onClick={open}
          aria-label={"Открыть " + b.name}
        >
          <Photo bike={b} />
        </button>
        <span className="card-type">
          <BikeCategoryIcon
            category={b.category}
            label={catalog.categories[b.category]}
          />
        </span>
        {b.is_public && (
          <button
            type="button"
            className="like-button"
            disabled={busy || b.is_owner || !onLike}
            aria-label={"Нравится: " + (b.likes || 0)}
            aria-pressed={!!b.liked}
            onClick={onLike}
          >
            <Heart size={16} fill={b.liked ? "currentColor" : "none"} />
            <span>{b.likes || 0}</span>
          </button>
        )}
        {ownerView && !b.is_public && (
          <span className="private-badge" title="Личный велосипед">
            <Lock size={14} />
          </span>
        )}
      </div>
      <div className="card-info">
        <div className="card-facts">
          <span>{b.year || ""}</span>
          <span>{b.color || ""}</span>
          <span>{b.size || ""}</span>
          <span>{b.weight ? Number(b.weight) + " кг" : ""}</span>
        </div>
        <h2>
          <button type="button" onClick={open}>
            {b.name || [b.brand, b.model].join(" ")}
          </button>
          <AuthorLink author={b.author} />
        </h2>
        <BikeMeters scores={b.scores} />
      </div>
    </article>
  );
}
