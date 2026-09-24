import { cache } from 'react';
import { notFound, permanentRedirect } from 'next/navigation';
import { db } from './db.js';
import { currentViewer } from './viewer.js';
import { findPublicLink, publicPayload } from './public-link-data.js';
import { loadSocialPreview } from './social-preview.js';
import { previewText, socialMetadata } from './social-metadata.js';
import { publicPath, publicHandle, preserveSearch, routeParam, absolutePublicUrl, uuidReference } from './public-urls.js';
import { indexed, hidden } from './indexing.js';
import { getSite } from './site.js';
import { visibleBike, showcase } from './showcase.js';
import { journalDetail } from './journal.js';
import { rideDetail } from './rides.js';
import { marketDetail } from './market.js';
import { articleDetail } from './articles.js';
import { getProfile } from './profiles.js';

const preview = cache((kind, reference) => loadSocialPreview(db, kind, reference));
const user = currentViewer;
export async function metadataFor(kind, reference, search = {}, options = {}) {
  // Resolve redirects before metadata can be flushed into the initial response.
  await canonicalPage(kind, reference, search, options);
  return socialMetadata(await preview(kind, routeParam(reference)));
}
// The canonical path of a page everyone can open, or null: only such pages
// offer the share button (#72). Reuses the request-cached preview.
export async function sharePath(kind, reference) {
  return (await preview(kind, routeParam(reference)))?.path || null;
}
export async function canonicalPage(kind, rawReference, search = {}, { legacyProfile = false } = {}) {
  const reference = routeParam(rawReference);
  const visible = await preview(kind, reference);
  const viewer = visible ? null : await user();
  const link = visible?.link || (viewer ? await findPublicLink(db, kind, reference, viewer.id) : null);
  // Hidden, deleted or never existed: a real 404, so search engines drop the
  // address (#74). Owners and invited riders pass through findPublicLink.
  if (!link) notFound();
  const handle = kind === 'profile' ? link.slug : publicHandle(link);
  if (reference !== handle || legacyProfile)
    permanentRedirect(preserveSearch(publicPath(kind, link), search));
  return kind === 'profile' ? handle : link.legacy_id; // Client API reads keep their existing UUID contract.
}

// Initial data for public pages (#74): the DTO each page's API returns, read
// on the server for the same viewer with the same lib functions. The HTML
// then carries the content and the client skips its first request.
const loaders = {
  bike: async (share, viewer) => {
    const bike = await visibleBike(db, share, viewer, await getSite());
    return bike && { bike };
  },
  journal: async (share, viewer) => ({ entry: await journalDetail(db, share, viewer) }),
  ride: async (share, viewer) => ({ ride: await rideDetail(db, share, viewer) }),
  market: async (share, viewer) => ({ listing: await marketDetail(db, share, viewer) }),
  article: async (share, viewer) => ({ article: await articleDetail(db, share, viewer) }),
  profile: async (username, viewer) => {
    const profile = await getProfile(db, username, viewer);
    return profile && { profile, bikes: await showcase(db, viewer, { page: 1, ownerId: profile.id }) };
  },
};
export const pageData = cache(async (kind, reference) => {
  const viewer = (await user())?.id || null;
  try {
    const data = await loaders[kind](reference, viewer);
    // The API's transport shape: public references resolved and dates as
    // strings, so the first client render matches the server HTML.
    return data ? JSON.parse(JSON.stringify(await publicPayload(db, data, viewer))) : null;
  } catch (error) {
    if ([401, 403, 404].includes(error?.status)) return null;
    throw error;
  }
});

// Articles keep their UUID address: they are not public_entity_links yet.
export async function articlePage(reference) {
  const share = routeParam(reference).toLowerCase();
  const data = uuidReference.test(share) ? await pageData('article', share) : null;
  if (!data) notFound();
  return data;
}
export async function articleMetadata(reference) {
  const { article } = await articlePage(reference);
  const title = previewText(article.title, 120) || 'Статья';
  // An owner's draft or hidden article stays out of search and previews.
  if (article.status !== 'published' || !article.isPublic)
    return { title: { absolute: title + ' · ColaBike' }, robots: hidden };
  const url = absolutePublicUrl('/articles/' + article.shareId);
  const description = previewText(article.body) || 'Статья в базе знаний ColaBike.';
  const cover = article.photos[0] ? absolutePublicUrl(article.photos[0].url + '?width=1280') : null;
  return {
    title: { absolute: title }, description, robots: indexed,
    alternates: { canonical: url },
    openGraph: {
      type: 'article', title, description, url, siteName: 'ColaBike', locale: 'ru_RU',
      images: cover ? [{ url: cover, alt: title }] : [],
    },
    twitter: { card: cover ? 'summary_large_image' : 'summary', title, description, images: cover ? [cover] : [] },
  };
}
