import { errorStatus } from "./errors.ts";
import type { SocialKind as SocialKindType } from "./social-preview.ts";
import type { JsonData as JsonDataType } from "./contracts.ts";
import { cache } from "react";
import { notFound, permanentRedirect } from "next/navigation";
import { db } from "./db.ts";
import { currentViewer } from "./viewer.ts";
import { findPublicLink, publicPayload } from "./public-link-data.ts";
import { loadSocialPreview } from "./social-preview.ts";
import { previewText, socialMetadata } from "./social-metadata.ts";
import {
  publicPath,
  publicHandle,
  preserveSearch,
  routeParam,
  absolutePublicUrl,
  uuidReference,
} from "./public-urls.ts";
import { indexed, hidden } from "./indexing.ts";
import { getSite } from "./site.ts";
import { visibleBike, showcase } from "./showcase.ts";
import { journalDetail } from "./journal.ts";
import { rideDetail } from "./rides.js";
import { marketDetail, sellerListings } from "./market.ts";
import { articleDetail } from "./articles.ts";
import { getProfile } from "./profiles.ts";

const preview = cache((kind: SocialKindType, reference: string) =>
  loadSocialPreview(db, kind, reference),
);
const user = currentViewer;
export async function metadataFor(
  kind: SocialKindType,
  reference: string,
  search = {},
  options = {},
) {
  // Resolve redirects before metadata can be flushed into the initial response.
  await canonicalPage(kind, reference, search, options);
  return socialMetadata(await preview(kind, routeParam(reference)));
}
// The canonical path of a page everyone can open, or null: only such pages
// offer the share button (#72). Reuses the request-cached preview.
export async function sharePath(kind: SocialKindType, reference: string) {
  return (await preview(kind, routeParam(reference)))?.path || null;
}
export async function canonicalPage(
  kind: SocialKindType,
  rawReference: string,
  search = {},
  { legacyProfile = false } = {},
) {
  const reference = routeParam(rawReference);
  const visible = await preview(kind, reference);
  const viewer = visible ? null : await user();
  const link =
    visible?.link ||
    (viewer ? await findPublicLink(db, kind, reference, viewer.id) : null);
  // Hidden, deleted or never existed: a real 404, so search engines drop the
  // address (#74). Owners and invited riders pass through findPublicLink.
  if (!link) notFound();
  const handle = kind === "profile" ? link.slug : publicHandle(link);
  if (reference !== handle || legacyProfile)
    permanentRedirect(preserveSearch(publicPath(kind, link), search));
  return kind === "profile" ? handle : link.legacy_id; // Client API reads keep their existing UUID contract.
}

// Initial data for public pages (#74): the DTO each page's API returns, read
// on the server for the same viewer with the same lib functions. The HTML
// then carries the content and the client skips its first request.
const loaders = {
  bike: async (share: string, viewer: string | null) => {
    const bike = await visibleBike(db, share, viewer, await getSite());
    return bike && { bike };
  },
  journal: async (share: string, viewer: string | null) => ({
    entry: await journalDetail(db, share, viewer),
  }),
  ride: async (share: string, viewer: string | null) => ({
    ride: await rideDetail(db, share, viewer),
  }),
  market: async (share: string, viewer: string | null) => {
    const listing = await marketDetail(db, share, viewer);
    return { listing, others: await sellerListings(db, listing.id, viewer) };
  },
  article: async (share: string, viewer: string | null) => ({
    article: await articleDetail(db, share, viewer),
  }),
  profile: async (username: string, viewer: string | null) => {
    const profile = await getProfile(db, username, viewer);
    return (
      profile && {
        profile,
        bikes: await showcase(db, viewer, { page: 1, ownerId: profile.id }),
      }
    );
  },
};
export const pageData = cache(
  async <K extends keyof typeof loaders>(
    kind: K,
    reference: string,
  ): Promise<JsonDataType<Awaited<ReturnType<(typeof loaders)[K]>>> | null> => {
    const viewer = (await user())?.id || null;
    try {
      const data = await loaders[kind](reference, viewer);
      // The API's transport shape: public references resolved and dates as
      // strings, so the first client render matches the server HTML.
      return data
        ? JSON.parse(JSON.stringify(await publicPayload(db, data, viewer)))
        : null;
    } catch (error) {
      if ([401, 403, 404].includes(errorStatus(error) ?? 0)) return null;
      throw error;
    }
  },
);

// Articles keep their UUID address: they are not public_entity_links yet.
export async function articlePage(reference: string) {
  const share = routeParam(reference).toLowerCase();
  const data = uuidReference.test(share)
    ? await pageData("article", share)
    : null;
  if (!data) notFound();
  return data;
}
export async function articleMetadata(reference: string) {
  const { article } = await articlePage(reference);
  const title = previewText(article.title, 120) || "Статья";
  // An owner's draft or hidden article stays out of search and previews.
  if (article.status !== "published" || !article.isPublic)
    return { title: { absolute: title + " · ColaBike" }, robots: hidden };
  const url = absolutePublicUrl("/articles/" + article.shareId);
  const description =
    previewText(article.body) || "Статья в базе знаний ColaBike.";
  const cover = article.photos[0]
    ? absolutePublicUrl(article.photos[0].url + "?width=1280")
    : null;
  return {
    title: { absolute: title },
    description,
    robots: indexed,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      title,
      description,
      url,
      siteName: "ColaBike",
      locale: "ru_RU",
      images: cover ? [{ url: cover, alt: title }] : [],
    },
    twitter: {
      card: cover ? "summary_large_image" : "summary",
      title,
      description,
      images: cover ? [cover] : [],
    },
  };
}
