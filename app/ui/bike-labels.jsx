"use client";
import SiteIcon from "./site-icon.jsx";
import { ClassificationBadges } from "./bike-classification.jsx";
import { ContentLabel, LabelRow } from "./content-label.jsx";
export function BikeLabels({ bike }) {
  return (
    <LabelRow className="bike-labels" aria-label="Характеристики велосипеда">
      {bike.is_former && <ContentLabel className="hf-label" data-bike-label="former">Бывший</ContentLabel>}
      {bike.size && (
        <ContentLabel className="hf-label" data-bike-label="size" aria-label={"Размер рамы: " + bike.size}>
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
        <SiteIcon name="heart" />
        {t("Нравится")}
      </span>
      <strong>{reaction.likes ?? 0}</strong>
    </button>
  );
}
