"use client";
import SiteIcon from "./site-icon.jsx";
import { ClassificationBadges } from "./bike-classification.jsx";
import { ContentLabel, LabelRow } from "./content-label.jsx";
// The year, the size and the weight in one row: on cards and under the
// title of the bike page (#131).
export function BikeLabels({ bike }) {
  return (
    <LabelRow className="bike-labels" aria-label="Характеристики велосипеда">
      {bike.is_former && (
        <ContentLabel className="hf-label" data-bike-label="former">
          Бывший
        </ContentLabel>
      )}
      {bike.year && (
        <ContentLabel
          className="hf-label"
          tone="year"
          data-bike-label="year"
          aria-label={"Модельный год: " + bike.year}
        >
          {bike.year}
        </ContentLabel>
      )}
      {bike.size && (
        <ContentLabel
          className="hf-label"
          data-bike-label="size"
          aria-label={"Размер рамы: " + bike.size}
        >
          <SiteIcon name="size" />
          <span>{bike.size}</span>
        </ContentLabel>
      )}
      {bike.weight != null && Number(bike.weight) > 0 && (
        <ContentLabel
          className="hf-label"
          data-bike-label="weight"
          aria-label={"Вес: " + Number(bike.weight) + " кг"}
        >
          <SiteIcon name="weight" />
          <span>{Number(bike.weight).toLocaleString("ru-RU")} кг</span>
        </ContentLabel>
      )}
      <ClassificationBadges bike={bike} />
    </LabelRow>
  );
}
// `compact`: the heart and the count only (cards); the bike page keeps the
// word «Нравится» next to the heart (#121).
export function BikeLike({ bike, reaction, t = (s) => s, compact = false }) {
  return (
    <button
      type="button"
      className={"like-button hf-like" + (compact ? " compact" : "")}
      data-hover="like"
      disabled={bike.is_owner}
      aria-label={
        t("Нравится") + (reaction.likes == null ? "" : ": " + reaction.likes)
      }
      aria-pressed={reaction.liked}
      aria-busy={reaction.pending}
      onClick={reaction.toggle}
    >
      <span>
        <SiteIcon name="heart" size={compact ? 14 : 16} />
        {!compact && t("Нравится")}
      </span>{" "}
      <strong>{reaction.likes ?? 0}</strong>
    </button>
  );
}
