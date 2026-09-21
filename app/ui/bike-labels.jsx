"use client";
import SiteEmoji from "./site-emoji.jsx";
export function BikeLabels({ bike }) {
  return (
    <div className="bike-labels">
      {bike.size && (
        <span className="hf-label" aria-label={"Размер рамы: " + bike.size}>
          <SiteEmoji name="size" />
          <span>{bike.size}</span>
        </span>
      )}
      {bike.weight != null && Number(bike.weight) > 0 && (
        <span
          className="hf-label"
          aria-label={"Вес: " + Number(bike.weight) + " кг"}
        >
          <SiteEmoji name="weight" />
          <span>{Number(bike.weight).toLocaleString("ru-RU")} кг</span>
        </span>
      )}
    </div>
  );
}
export function BikeLike({ bike, reaction, t = (s) => s }) {
  return (
    <button
      type="button"
      className="like-button hf-like"
      disabled={bike.is_owner}
      aria-label={
        t("Нравится") + (reaction.likes == null ? "" : ": " + reaction.likes)
      }
      aria-pressed={reaction.liked}
      aria-busy={reaction.pending}
      onClick={reaction.toggle}
    >
      <span>
        <SiteEmoji name="heart" />
        {t("Нравится")}
      </span>
      <strong>{reaction.likes ?? 0}</strong>
    </button>
  );
}
