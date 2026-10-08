"use client";
import type * as React from "react";
import type { BikeDto, SiteCatalog } from "../../../lib/contracts.ts";
import BikeActions from "../bike-actions.tsx";
import { Avatar } from "../avatar.tsx";
import {
  Heart,
  MessageCircle,
  Package,
  Plus,
  Quote,
  Route,
} from "../icons.tsx";
import { bikeExcerpt, bikeSubtitle } from "../../../lib/garage-layout.ts";
import { personName, usernameLabel } from "../../../lib/usernames.ts";
import { profilePath } from "../../../lib/public-urls.ts";

type ActionProps = Omit<Parameters<typeof BikeActions>[0], "section">;
type Figure = {
  key: string;
  label: string;
  value: number;
  icon: React.ReactNode;
  href?: string;
};

// The right column of the first screen (#291): owner tools, the name with its
// type, the author, the real figures, the reader's actions and a quote from
// the description.
export default function BikeIdentity({
  bike,
  catalog,
  actions,
  metrics,
  quote,
  specifications,
  rideTotal,
  likes,
  onSection,
  onRegister,
  t,
}: {
  bike: BikeDto;
  catalog: SiteCatalog;
  actions: ActionProps;
  metrics: boolean;
  quote: boolean;
  // The «Parts» figure leads to the build only when the page has one.
  specifications: boolean;
  rideTotal: number | null;
  likes: number;
  // Opens the tab of the bike page that a counter or a link points at.
  onSection?: (id: string) => void;
  onRegister?: () => void;
  t: (text: string) => string;
}) {
  const title = actions.title;
  const subtitle = bikeSubtitle(bike, catalog);
  const excerpt = quote ? bikeExcerpt(bike.description) : null;
  const author = bike.author;
  // A counter or a link to a tab opens that tab; the plain anchor is what a
  // new window or a middle click still gets.
  const open = (event: React.MouseEvent<HTMLAnchorElement>) => {
    const id = event.currentTarget.hash.slice(1);
    if (
      !onSection ||
      !id ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    onSection(id);
  };
  const figures: Figure[] = [];
  if (bike.is_public) {
    figures.push(
      {
        key: "likes",
        label: t("Нравится"),
        value: likes,
        icon: <Heart size={20} aria-hidden="true" />,
      },
      {
        key: "comments",
        label: t("Комментарии"),
        value: bike.comments,
        icon: <MessageCircle size={20} aria-hidden="true" />,
        href: "#discussion",
      },
    );
    if (rideTotal !== null)
      figures.push({
        key: "rides",
        label: t("Покатушек"),
        value: rideTotal,
        icon: <Route size={20} aria-hidden="true" />,
        href: "#bike-rides",
      });
  }
  figures.push({
    key: "parts",
    label: t("Деталей"),
    value: bike.components.length,
    icon: <Package size={20} aria-hidden="true" />,
    href: specifications ? "#specifications" : undefined,
  });
  return (
    <div className="bike-identity">
      {(bike.brand || bike.is_former || actions.editable) && (
        <div className="bike-topline">
          {(bike.brand || bike.is_former) && (
            <p className="bike-kicker">
              {bike.brand && <span>{bike.brand}</span>}
              {bike.is_former && (
                <span className="bike-former" data-bike-label="former">
                  {t("Бывший")}
                </span>
              )}
            </p>
          )}
          <BikeActions {...actions} section="owner" />
        </div>
      )}
      <div className="bike-heading">
        <div className="bike-detail-title-row">
          <h1>{title}</h1>
        </div>
        {subtitle && <p className="bike-subtitle">{subtitle}</p>}
        {(author || onRegister) && (
          <div className="detail-actions bike-author">
            {author && (
              <a
                className="author-link bike-author-link"
                href={profilePath(author.username)}
              >
                <Avatar person={author} />
                <span>
                  <strong>{personName(author)}</strong>
                  {usernameLabel(author) && (
                    <small>{usernameLabel(author)}</small>
                  )}
                </span>
              </a>
            )}
            {onRegister && (
              <button className="button secondary" onClick={onRegister}>
                {t("Добавить свой байк")}
                <Plus size={17} />
              </button>
            )}
          </div>
        )}
      </div>
      {metrics && (
        <ul className="bike-metrics" aria-label={t("Показатели велосипеда")}>
          {figures.map((item) => {
            const body = (
              <>
                {item.icon}
                <span>
                  <strong>{item.value}</strong>
                  <small>{item.label}</small>
                </span>
              </>
            );
            return (
              <li key={item.key}>
                {item.href ? (
                  <a href={item.href} onClick={open}>
                    {body}
                  </a>
                ) : (
                  <div>{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <BikeActions {...actions} section="social" />
      {metrics && excerpt && (
        <figure className="bike-quote">
          <Quote size={22} aria-hidden="true" />
          <blockquote>
            <p className="bike-excerpt">{excerpt}</p>
          </blockquote>
          {author && <figcaption>— {personName(author)}</figcaption>}
          <a href="#overview" onClick={open}>
            {t("Читать полностью")}
          </a>
        </figure>
      )}
    </div>
  );
}
