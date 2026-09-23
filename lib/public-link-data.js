import { CommunityError } from './community-validation.js';
import { parsePublicReference, publicKinds, publicPath, profilePath, uuidReference } from './public-urls.js';

const canRead = `l.is_public OR l.owner_id=$2::uuid OR
  (l.kind='ride' AND EXISTS(SELECT 1 FROM ride_invitations i WHERE i.ride_id=l.entity_id AND i.user_id=$2::uuid))`;

export async function findPublicLink(q, kind, reference, viewer = null, { publicOnly = false, byPublicId = false } = {}) {
  if (!Object.hasOwn(publicKinds, kind)) return null;
  let parsed = parsePublicReference(reference);
  let username = null;
  if (kind === 'profile' && !byPublicId && !parsed?.legacyId) {
    username = String(reference || '').replace(/^@/, '').toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(username)) return null;
    parsed = null;
  } else if (!parsed) return null;
  const result = await q.query(`SELECT l.* FROM public_entity_links l
    WHERE l.kind=$1 AND (${publicOnly ? 'l.is_public AND ($2::uuid IS NULL OR true)' : canRead})
    AND (l.entity_id=(SELECT a.entity_id FROM public_url_aliases a WHERE a.kind=$1 AND a.legacy_id=$3::uuid) OR l.public_id=$4 OR (l.kind='profile' AND l.slug=$5)) LIMIT 1`,
  [kind, viewer, parsed?.legacyId || null, parsed?.publicId || null, username]);
  if (result.rows[0] || !username) return result.rows[0] || null;
  // A renamed profile keeps its old address: the caller redirects to the slug.
  const renamed = await q.query(`SELECT l.* FROM username_history h
    JOIN public_entity_links l ON l.kind='profile' AND l.entity_id=h.user_id
    WHERE lower(h.username)=$1 LIMIT 1`, [username]);
  return renamed.rows[0] || null;
}

// Resolve either URL format while preserving the legacy UUID API contract.
// The normal domain read must still authorize access after resolving this alias.
export async function legacyShare(q, kind, reference) {
  const parsed = parsePublicReference(reference);
  if (parsed?.legacyId) {
    const { rows } = await q.query(`SELECT l.legacy_id FROM public_url_aliases a
      JOIN public_entity_links l ON l.kind=a.kind AND l.entity_id=a.entity_id
      WHERE a.kind=$1 AND a.legacy_id=$2::uuid`, [kind, parsed.legacyId]);
    return rows[0]?.legacy_id || parsed.legacyId;
  }
  if (parsed?.publicId && Object.hasOwn(publicKinds, kind)) {
    const { rows } = await q.query('SELECT legacy_id FROM public_entity_links WHERE kind=$1 AND public_id=$2', [kind, parsed.publicId]);
    if (rows[0]) return rows[0].legacy_id;
  }
  throw new CommunityError('Не найдено', 404);
}

const localLink = /^\/(b|j|r|market)\/([0-9a-f-]{36})([?#].*)?$/i;
const prefixKind = { b: 'bike', j: 'journal', r: 'ride', market: 'market' };
const contextKinds = { bike: 'bike', bikes: 'bike', popular: 'bike', holder: 'bike', entry: 'journal', entries: 'journal', ride: 'ride', rides: 'ride', listing: 'market', listings: 'market' };
const referenceKeys = new Set(['share_id', 'shareId']);
const linkKeys = new Set(['href', 'url', 'publicUrl', 'canonicalUrl']);
function referencesIn(value, refs = new Set()) {
  if (!value || typeof value !== 'object') return refs;
  for (const [key, child] of Object.entries(value)) {
    if (referenceKeys.has(key) && typeof child === 'string' && uuidReference.test(child)) refs.add(child.toLowerCase());
    else if (linkKeys.has(key) && typeof child === 'string') {
      const match = localLink.exec(child);
      if (match) refs.add(match[2].toLowerCase());
    } else if (child && typeof child === 'object') referencesIn(child, refs);
  }
  return refs;
}
export function hasPublicReferences(data) {
  return referencesIn(data).size > 0;
}

// Resolve references in a single indexed batch, never N+1 calls per card. Apply
// the same read visibility as pages before adding even a name-derived slug.
// Only server-controlled reference/link fields change; author text is untouched.
export async function publicPayload(q, data, viewer = null) {
  const refs = [...referencesIn(data)];
  const rows = refs.length ? (await q.query(`SELECT l.*,a.legacy_id lookup_id FROM public_url_aliases a
    JOIN public_entity_links l ON l.kind=a.kind AND l.entity_id=a.entity_id
    WHERE a.legacy_id=ANY($1::uuid[]) AND (${canRead})`, [refs, viewer])).rows : [];
  const byLegacy = new Map();
  for (const row of rows) {
    const entries = byLegacy.get(row.lookup_id) || [];
    entries.push(row);
    byLegacy.set(row.lookup_id, entries);
  }
  function lookup(reference, kind) {
    const entries = byLegacy.get(String(reference).toLowerCase()) || [];
    return entries.find((entry) => entry.kind === kind) || (entries.length === 1 ? entries[0] : null);
  }
  function visit(value, kind) {
    if (Array.isArray(value)) return value.map((entry) => visit(entry, kind));
    if (!value || typeof value !== 'object' || value instanceof Date) return value;
    const ownKind = Object.hasOwn(publicKinds, value.kind || '') ? value.kind : kind;
    const result = {};
    let identity = null;
    for (const [key, child] of Object.entries(value)) {
      if (referenceKeys.has(key) && typeof child === 'string') {
        const row = lookup(child, ownKind);
        if (row && row.kind !== 'profile') identity = row;
        result[key] = child; // Never change a legacy UUID field's meaning at the transport boundary.
      } else if (linkKeys.has(key) && typeof child === 'string') {
        const match = localLink.exec(child);
        const row = match && lookup(match[2], prefixKind[match[1]]);
        result[key] = row ? publicPath(row.kind, row) + (match[3] || '') :
          child.replace(/^\/u\/([a-z0-9._-]+)(?=[?#]|$)/i, (_, username) => profilePath(username));
      } else result[key] = visit(child, contextKinds[key] || ownKind);
    }
    if (identity) {
      result.public_id = identity.public_id;
      result.slug = identity.slug;
    }
    return result;
  }
  return visit(data, null);
}
