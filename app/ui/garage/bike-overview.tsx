"use client";
import type { LucideIcon } from "lucide-react";
import type { BikeDto } from "../../../lib/contracts.ts";
import type {
  OverviewPanels,
  PassportKey,
} from "../../../lib/bike-passport.ts";
import {
  Banknote,
  Bike,
  CalendarDays,
  CircleCheck,
  ExternalLink,
  Gauge,
  History,
  Info,
  Palette,
  Pencil,
  Route,
  Ruler,
  Tag,
  Weight,
} from "../icons.tsx";

const passportIcons: Record<PassportKey, LucideIcon> = {
  type: Bike,
  use: Route,
  model: Tag,
  year: CalendarDays,
  size: Ruler,
  color: Palette,
  weight: Weight,
  status: CircleCheck,
  mileage: Gauge,
  price: Banknote,
};

// The two panels under the first screen (#291): the owner's own words and a
// passport of the general facts. `overviewPanels` decides which of them have
// something to show, an empty panel is not drawn.
export default function BikeOverview({
  bike,
  panels,
  editable,
  onEdit,
  t,
}: {
  bike: BikeDto;
  panels: OverviewPanels;
  editable: boolean;
  onEdit: () => void;
  t: (text: string) => string;
}) {
  const paragraphs = (bike.description || "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  return (
    <div
      className="bike-overview"
      id="overview"
      data-panels={Number(panels.about) + Number(panels.passport)}
    >
      {panels.about && (
        <section
          className="bike-panel bike-about"
          aria-labelledby="bike-about-title"
        >
          <h2 id="bike-about-title">{t("О велосипеде")}</h2>
          {paragraphs.length > 0 ? (
            <div className="bike-about-text">
              {paragraphs.map((text, i) => (
                <p key={i}>{text}</p>
              ))}
            </div>
          ) : (
            <div className="bike-about-empty">
              <Info size={18} aria-hidden="true" />
              <p>{t("Описание пока не добавлено.")}</p>
              {editable && (
                <button type="button" className="quiet" onClick={onEdit}>
                  <Pencil size={14} aria-hidden="true" />
                  {t("Добавить описание")}
                </button>
              )}
            </div>
          )}
        </section>
      )}
      {panels.passport && (
        <section
          className="bike-panel bike-passport"
          aria-labelledby="bike-passport-title"
        >
          <h2 id="bike-passport-title">{t("Паспорт велосипеда")}</h2>
          <dl>
            {panels.rows.map((row) => {
              const Icon =
                row.key === "status" && bike.is_former
                  ? History
                  : passportIcons[row.key];
              return (
                <div key={row.key} data-passport={row.key}>
                  <dt>
                    <Icon size={18} aria-hidden="true" />
                    <span>{t(row.label)}</span>
                  </dt>
                  <dd>
                    {row.key === "status" && (
                      <span
                        className="status-dot"
                        data-tone={bike.is_former ? "former" : "current"}
                        aria-hidden="true"
                      />
                    )}
                    {row.value}
                  </dd>
                </div>
              );
            })}
          </dl>
          {panels.manufacturerUrl && (
            <a
              className="part-link"
              href={panels.manufacturerUrl}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={12} aria-hidden="true" />
              {t("Сайт производителя")}
            </a>
          )}
        </section>
      )}
    </div>
  );
}
