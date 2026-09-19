"use client";
import { Heart, Lock, MessageCircle } from "lucide-react";
import Photo from "./bike-photo.jsx";
import { AuthorLink } from "./social-primitives.jsx";
import { useSite } from "./site-provider.jsx";
import SiteAssetIcon from "./site-asset-icon.jsx";
import { MicroMetrics, ImportantBadge } from "./compact-ui.jsx";
import { useGridRecords } from "./bike-grid.jsx";
export default function BikeCard({
  bike: b,
  onOpen,
  onLike,
  busy = false,
  ownerView = false,
}) {
  const { catalog, personalSettings: settings } = useSite(),
    records = useGridRecords();
  const title = b.name || [b.brand, b.model].join(" ");
  const open = onOpen || (() => window.location.assign("/b/" + b.share_id));
  const facts = [
    b.year && { key: "year", text: b.year },
    catalog.categories[b.category] && {
      key: "category",
      text: catalog.categories[b.category],
    },
    b.weight && { key: "weight", text: Number(b.weight) + " кг" },
    b.size && { key: "size", text: b.size },
  ].filter(Boolean);
  return (
    <article className="bike-card">
      <div className="card-photo">
        <button
          className="card-open-photo"
          type="button"
          onClick={open}
          aria-label={"Открыть " + title}
        >
          <Photo bike={b} />
        </button>
        {ownerView && !b.is_public && (
          <span
            className="private-badge"
            title="Личный велосипед"
            aria-label="Личный велосипед"
          >
            <Lock size={14} />
          </span>
        )}
      </div>
      <div className="card-info">
        <div className="card-facts">
          {facts.map((f) => (
            <span
              key={f.key}
              className={"fact-" + f.key}
              title={String(f.text)}
            >
              {f.text}
            </span>
          ))}
        </div>
        <h2>
          <button type="button" onClick={open} title={title}>
            {title}
          </button>
        </h2>
        <div className="card-social">
          <AuthorLink author={b.author} />
          {b.is_public && (
            <div className="card-social-stats">
              <button
                type="button"
                className="social-stat like-button"
                disabled={busy || b.is_owner || !onLike}
                aria-label={"Нравится: " + (b.likes || 0)}
                aria-pressed={!!b.liked}
                onClick={onLike}
              >
                <SiteAssetIcon
                  assetId={settings.likeIconId}
                  Fallback={Heart}
                  size={16}
                  className="like-graphic"
                  fallbackProps={{ fill: b.liked ? "currentColor" : "none" }}
                />
                <span>{b.likes || 0}</span>
              </button>
              <a
                className="social-stat card-comments"
                href={"/b/" + b.share_id + "#discussion"}
                aria-label={"Комментарии: " + (b.comments || 0)}
              >
                <MessageCircle size={15} />
                <span>{b.comments || 0}</span>
              </a>
            </div>
          )}
        </div>
        <div className="card-signals">
          <MicroMetrics scores={b.scores} />
          <ImportantBadge bike={b} records={records} />
        </div>
      </div>
    </article>
  );
}
