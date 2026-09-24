import { classificationQueryShape } from "./classification-validation.js";
import { classificationWhere } from "./classification-sql.js";
import {
  categoryFilterLabels,
  classificationOf,
} from "./bike-classification.js";
import { z } from "zod";
import { showcase } from "./showcase.js";
import { records } from "./gamification.js";
import { achievements } from "./gamification-definitions.js";
import { journalPublic, journalFrom } from "./journal.js";
import { effectiveRide, rideFrom } from "./rides.js";
import { plainExcerpt } from "./excerpt.js";
import { richExcerpt } from "./rich-text.js";
import { listingPriceLabel } from "./market-types.js";
/** @typedef {z.infer<typeof discoveryInput>} DiscoveryInput */
export const discoveryInput = z.object({
  ...classificationQueryShape,
  category: z.enum(["", ...Object.keys(categoryFilterLabels)]).default(""),
  q: z
    .string()
    .trim()
    .max(150)
    .refine((s) => !s.includes("\0"))
    .default(""),
  type: z.enum(["all", "bikes", "components", "rides"]).default("all"),
  component: z
    .string()
    .trim()
    .max(150)
    .refine((s) => !s.includes("\0"))
    .default(""),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  suggest: z.enum(["0", "1"]).default("0"),
});
const publicBikes =
  " FROM bikes b JOIN users u ON u.id=b.owner_id WHERE b.is_public AND NOT u.blocked";
const literalMatch = (expression) =>
  `strpos(lower(normalize(${expression},NFKC)),lower(normalize($1::text,NFKC)))>0`;
const thumb = (id) => (id ? `/api/photos/${id}?width=160` : null);
/** @param {DiscoveryInput} input */
export async function discoverySearch(q, input) {
  const term = input.q || input.component;
  const params = [term];
  const facets = classificationWhere(
    input,
    params,
    input.category ? [input.category] : [],
  );
  if (!term && !facets)
    return { groups: [], total: 0, page: input.page, pageSize: 24, query: "" };
  const limit = input.suggest === "1" ? 4 : input.type === "all" ? 8 : 24;
  const offset =
    input.suggest === "1" || input.type === "all"
      ? 0
      : (input.page - 1) * limit;
  const definitions = {
    bikes: {
      label: "Велосипеды",
      sql: `SELECT b.id,b.share_id,b.name title,u.name author,b.category,b.classification,b.weight,
        (SELECT id FROM photos WHERE bike_id=b.id ORDER BY is_cover DESC,created_at,id LIMIT 1) photo_id
        ${publicBikes} AND ${
          input.component
            ? "EXISTS(SELECT 1 FROM components p WHERE p.bike_id=b.id AND lower(normalize(p.name,NFKC))=lower(normalize($1::text,NFKC)))"
            : `(${literalMatch("b.name||' '||b.brand||' '||b.model||' '||u.name||' '||u.username")} OR EXISTS(SELECT 1 FROM components p WHERE p.bike_id=b.id AND ${literalMatch("p.name")}))`
        }${facets}`,
      order: "title,id",
      map: (r) => ({
        type: "bike",
        id: r.id,
        title: r.title,
        subtitle: r.author,
        href: "/b/" + r.share_id,
        image: thumb(r.photo_id),
        metadata: {
          category: r.category,
          classification: classificationOf(r),
          weight: r.weight,
        },
      }),
    },
    components: {
      label: "Компоненты",
      sql: `SELECT min(p.name) title,count(DISTINCT b.id)::int bikes FROM components p JOIN bikes b ON b.id=p.bike_id JOIN users u ON u.id=b.owner_id WHERE b.is_public AND NOT u.blocked AND ${literalMatch("p.name")}${facets} GROUP BY lower(normalize(p.name,NFKC))`,
      order: "bikes DESC,title",
      map: (r) => ({
        type: "component",
        id: r.title,
        title: r.title,
        subtitle: `Велосипедов: ${r.bikes}`,
        href:
          "/search?" +
          new URLSearchParams({
            ...Object.fromEntries(
              Object.entries(input).filter(
                ([key, value]) =>
                  (key === "category" ||
                    Object.hasOwn(classificationQueryShape, key)) &&
                  value,
              ),
            ),
            type: "bikes",
            component: r.title,
          }),
        image: null,
        metadata: { bikes: r.bikes },
      }),
    },
    rides: {
      label: "Покатушки",
      sql: `SELECT r.id,r.share_id,r.title,u.name author,r.distance_m,r.started_at ${rideFrom} WHERE ${effectiveRide} AND ${literalMatch("r.title||' '||r.description||' '||u.name||' '||u.username||' '||b.name")}${facets}`,
      order: "started_at DESC NULLS LAST,id",
      map: (r) => ({
        type: "ride",
        id: r.id,
        title: r.title,
        subtitle: r.author,
        href: "/r/" + r.share_id,
        image: null,
        metadata: { distanceM: r.distance_m },
      }),
    },
  };
  const groups = await Promise.all(
    Object.entries(definitions)
      .filter(([key]) => input.type === "all" || input.type === key)
      .map(async ([type, d]) => {
        const total = (
          await q.query(
            `SELECT count(*)::int total FROM (${d.sql}) results`,
            params,
          )
        ).rows[0].total;
        const rows = (
          await q.query(
            `${d.sql} ORDER BY ${d.order} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            [...params, limit, offset],
          )
        ).rows;
        return { type, label: d.label, total, items: rows.map(d.map) };
      }),
  );
  return {
    groups: groups.filter((g) => g.total),
    total: groups.reduce((n, g) => n + g.total, 0),
    page: input.page,
    pageSize: limit,
    query: term,
  };
}
export function activityExcerpt(row) {
  if (row.type === "journal") return richExcerpt(row.source_text || "", 180);
  if (row.type === "market")
    return [
      listingPriceLabel({
        listingType: row.listing_type,
        price: row.price,
        currency: row.currency,
      }),
      plainExcerpt(row.source_text, 140),
    ]
      .filter(Boolean)
      .join(" · ");
  return plainExcerpt(row.source_text, 180);
}
// Public visibility is evaluated on every request; no stale shared privacy cache.
// Branch limits bound sorting/mapping and avoid hydrating ride geometry or full posts.
export async function communityActivity(q) {
  // Raw text is formatted in JS: journal Markdown becomes plain text and market
  // prices use the same labels as /market, including listings without a price.
  const none =
    "NULL::numeric price,NULL::text currency,NULL::text listing_type";
  const sources = [
    `(SELECT 'market' type,m.id::text id,m.title,'/market/'||m.share_id href,u.name author,m.published_at occurred_at,left(m.description,1000) source_text,m.price::numeric price,m.currency,m.listing_type,NULL::integer distance_m,NULL::text achievement_key FROM market_listings m JOIN users u ON u.id=m.owner_id WHERE m.status='active' AND NOT u.blocked ORDER BY m.published_at DESC,m.id LIMIT 12)`,
    `(SELECT 'bike' type,b.id::text id,b.name title,'/b/'||b.share_id href,u.name author,b.published_at occurred_at,NULL::text source_text,${none},NULL::integer distance_m,NULL::text achievement_key ${publicBikes} ORDER BY b.published_at DESC,b.id LIMIT 12)`,
    `(SELECT 'journal' type,e.id::text id,e.title,'/j/'||e.share_id href,u.name author,e.published_at occurred_at,left(e.body,4000) source_text,${none},NULL::integer distance_m,NULL::text achievement_key ${journalFrom} WHERE ${journalPublic} ORDER BY e.published_at DESC,e.id LIMIT 12)`,
    `(SELECT CASE WHEN r.status='planned' THEN 'planned' ELSE 'ride' END type,r.id::text id,r.title,'/r/'||r.share_id href,u.name author,r.published_at occurred_at,left(r.description,1000) source_text,${none},CASE WHEN r.source_kind='planned' AND NOT r.has_track THEN NULL::integer ELSE r.distance_m END distance_m,NULL::text achievement_key ${rideFrom} WHERE ${effectiveRide} AND r.status<>'cancelled' ORDER BY r.published_at DESC,r.id LIMIT 12)`,
    `(SELECT 'achievement' type,a.id::text id,'' title,CASE WHEN b.id IS NOT NULL THEN '/b/'||b.share_id ELSE '/@'||u.username END href,u.name author,a.awarded_at occurred_at,NULL::text source_text,${none},NULL::integer distance_m,a.achievement_key FROM achievement_awards a JOIN users u ON u.id=a.user_id LEFT JOIN bikes b ON b.id=a.bike_id LEFT JOIN users owner ON owner.id=b.owner_id WHERE NOT u.blocked AND (a.bike_id IS NULL OR (b.is_public AND NOT owner.blocked)) ORDER BY a.awarded_at DESC,a.id LIMIT 12)`,
  ];
  const rows = (
    await q.query(
      `SELECT * FROM (${sources.join(" UNION ALL ")}) activity ORDER BY occurred_at DESC NULLS LAST,type,id LIMIT 48`,
    )
  ).rows;
  const items = rows.flatMap((row) => {
    const title =
      row.type === "achievement"
        ? achievements.find((a) => a.key === row.achievement_key)?.name
        : row.title;
    return title
      ? [
          {
            id: `${row.type}:${row.id}`,
            type: row.type,
            title,
            href: row.href,
            author: row.author,
            occurredAt: row.occurred_at,
            excerpt: activityExcerpt(row),
            distanceM: row.distance_m,
          },
        ]
      : [];
  });
  const content = items.filter((i) => i.type !== "achievement").slice(0, 6);
  return { events: items.slice(0, 16), content };
}
export async function communityHome(q, viewer = null) {
  const [popular, activity, hall] = await Promise.all([
    showcase(q, viewer, { sort: "popular" }),
    communityActivity(q),
    records(q),
  ]);
  return {
    popular: popular.bikes
      .slice(0, 9)
      .map(
        ({
          id,
          share_id,
          name,
          brand,
          model,
          category,
          classification,
          weight,
          size,
          photos,
          author,
          likes,
          liked,
          comments,
          badges,
          is_owner,
          is_public,
        }) => ({
          id,
          share_id,
          name,
          brand,
          model,
          category,
          classification,
          weight,
          size,
          is_owner,
          is_public,
          photos: photos.slice(0, 1),
          author,
          likes,
          liked,
          comments,
          badges,
        }),
      ),
    totalBikes: popular.total,
    ...activity,
    records: hall.records.filter((r) => r.holder).slice(0, 4),
  };
}
