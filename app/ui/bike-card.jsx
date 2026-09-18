"use client";
import { Heart, Lock, MessageCircle } from "lucide-react";
import Photo from "./bike-photo.jsx";
import BikeCategoryIcon from "./bike-category-icon.jsx";
import BikeMeters from "./bike-meters.jsx";
import { AuthorLink } from "./social-primitives.jsx";
import { useSite } from "./site-provider.jsx";
import SiteAssetIcon from "./site-asset-icon.jsx";
export default function BikeCard({
  bike: b,
  onOpen,
  onLike,
  busy = false,
  ownerView = false,
}) {
  const { catalog, personalSettings: settings } = useSite();
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
            size={38}
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
            <SiteAssetIcon
              assetId={settings.likeIconId}
              Fallback={Heart}
              size={28}
              className="like-graphic"
              fallbackProps={{ fill: b.liked ? "currentColor" : "none" }}
            />
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
        {b.badges?.length>0&&<div className="card-awards">{b.badges.slice(0,2).map(a=><span key={a.key}>{a.name}</span>)}</div>}
        {b.is_public && <a className="card-comments" href={"/b/"+b.share_id+"#discussion"} aria-label={"Комментарии: "+(b.comments||0)}><MessageCircle size={12}/>{b.comments||0}</a>}
      </div>
    </article>
  );
}
