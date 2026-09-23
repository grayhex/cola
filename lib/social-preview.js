import { findPublicLink } from './public-link-data.js';
import { publicPath } from './public-urls.js';
import { previewText } from './social-metadata.js';

const photo = (bikeColumn) => `(SELECT filename FROM photos WHERE bike_id=${bikeColumn} ORDER BY is_cover DESC,created_at,id LIMIT 1)`;
const sources = {
  bike: `SELECT b.name title,b.description,${photo('b.id')} image_filename FROM bikes b WHERE b.id=$1`,
  journal: `SELECT e.title,e.body description,coalesce((SELECT filename FROM journal_photos WHERE entry_id=e.id ORDER BY created_at,id LIMIT 1),${photo('e.bike_id')}) image_filename FROM journal_entries e WHERE e.id=$1`,
  ride: `SELECT r.title,r.description,${photo('r.bike_id')} image_filename FROM rides r WHERE r.id=$1`,
  market: `SELECT m.title,m.description,(SELECT filename FROM market_photos WHERE listing_id=m.id ORDER BY created_at,id LIMIT 1) image_filename FROM market_listings m WHERE m.id=$1`,
  profile: `SELECT u.name title,u.bio description,CASE WHEN u.avatar_id IS NOT NULL THEN 'avatar-'||u.avatar_id||'.webp' END image_filename FROM users u WHERE u.id=$1`,
};
const author = (column) => `(SELECT name FROM users WHERE id=${column})`;
const bikeName = (column) => `(SELECT name FROM bikes WHERE id=${column})`;
// Only fields the public page already shows; they feed the branded image
// (#72), not the metadata. The route line is loaded for the image alone.
const cardSources = {
  bike: `SELECT jsonb_build_object('brand',b.brand,'model',b.model,'year',b.year,
    'category',b.category,'author',${author('b.owner_id')}) card FROM bikes b WHERE b.id=$1`,
  journal: `SELECT jsonb_build_object('kind',e.kind,'bike',${bikeName('e.bike_id')},
    'author',${author('e.owner_id')}) card FROM journal_entries e WHERE e.id=$1`,
  ride: `SELECT jsonb_build_object('status',r.status,'metrics',r.visible_metrics,'geometry',r.public_geometry,
    'distance',CASE WHEN r.source_kind='planned' AND NOT r.has_track THEN NULL ELSE r.distance_m END,
    'date',coalesce(r.import_metrics->>'activityDate',to_char(r.started_at AT TIME ZONE 'UTC','YYYY-MM-DD')),
    'bike',${bikeName('r.bike_id')},'author',${author('r.owner_id')}) card FROM rides r WHERE r.id=$1`,
  market: `SELECT jsonb_build_object('price',m.price,'currency',m.currency,'listingType',m.listing_type,
    'location',m.location,'author',${author('m.owner_id')}) card FROM market_listings m WHERE m.id=$1`,
  profile: `SELECT jsonb_build_object('username',u.username,'location',u.location,
    'bikes',(SELECT count(*)::int FROM bikes WHERE owner_id=u.id AND is_public)) card FROM users u WHERE u.id=$1`,
};
const descriptions = {
  bike: 'Велосипед и его история в сообществе ColaBike.',
  journal: 'История велосипеда в Журнале ColaBike.',
  ride: 'Покатушка в сообществе ColaBike.',
  market: 'Объявление на рынке ColaBike.',
  profile: 'Профиль и велосипеды участника ColaBike.',
};
// Public-only by design: never accept a session/owner parameter here. Both the
// metadata and the image endpoint use this gate, including inherited privacy.
export async function loadSocialPreview(q, kind, reference, options = {}) {
  const link = await findPublicLink(q, kind, reference, null, { publicOnly: true, byPublicId: options.byPublicId });
  if (!link) return null;
  // Read text, image and current visibility in one snapshot. A private parent
  // cannot leak its image through a journal entry or a ride.
  const result = await q.query(`SELECT content.*,l.public_id,l.slug,l.legacy_id
    FROM (${sources[kind]}) content JOIN public_entity_links l
      ON l.entity_id=$1 AND l.kind=$2 WHERE l.is_public`, [link.entity_id, kind]);
  const content = result.rows[0];
  if (!content) return null;
  const stillPublic = { ...link, public_id: content.public_id, slug: content.slug, legacy_id: content.legacy_id };
  return {
    kind, link: stillPublic,
    title: previewText(content.title, 120) || 'ColaBike',
    description: previewText(content.description) || descriptions[kind],
    image: { filename: content.image_filename || null },
    path: publicPath(kind, stillPublic),
  };
}
// Card fields for a preview that already passed the public gate; the same
// visibility join runs again, so a just-hidden entity yields nothing.
export async function loadSocialCard(q, preview) {
  const { rows } = await q.query(`SELECT content.card FROM (${cardSources[preview.kind]}) content
    JOIN public_entity_links l ON l.entity_id=$1 AND l.kind=$2 WHERE l.is_public`,
  [preview.link.entity_id, preview.kind]);
  return rows[0]?.card || null;
}
