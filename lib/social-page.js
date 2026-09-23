import { cache } from 'react';
import { permanentRedirect } from 'next/navigation';
import { db } from './db.js';
import { currentUser } from './auth.js';
import { findPublicLink } from './public-link-data.js';
import { loadSocialPreview } from './social-preview.js';
import { socialMetadata } from './social-metadata.js';
import { publicPath, publicHandle, preserveSearch, routeParam } from './public-urls.js';

const preview = cache((kind, reference) => loadSocialPreview(db, kind, reference));
const user = cache(currentUser);
export async function metadataFor(kind, reference, search = {}, options = {}) {
  // Resolve redirects before metadata can be flushed into the initial response.
  await canonicalPage(kind, reference, search, options);
  return socialMetadata(await preview(kind, routeParam(reference)));
}
export async function canonicalPage(kind, rawReference, search = {}, { legacyProfile = false } = {}) {
  const reference = routeParam(rawReference);
  const visible = await preview(kind, reference);
  const viewer = visible ? null : await user();
  const link = visible?.link || (viewer ? await findPublicLink(db, kind, reference, viewer.id) : null);
  if (!link) return reference; // Keep the existing client-side unavailable/owner workflow; metadata is generic/noindex.
  const handle = kind === 'profile' ? link.slug : publicHandle(link);
  if (reference !== handle || legacyProfile)
    permanentRedirect(preserveSearch(publicPath(kind, link), search));
  return kind === 'profile' ? handle : link.legacy_id; // Client API reads keep their existing UUID contract.
}
