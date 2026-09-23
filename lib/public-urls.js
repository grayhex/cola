// Shared, pure URL contract. Never use a request Host header for an absolute URL.
export const publicKinds = Object.freeze({
  bike: '/b/', journal: '/j/', ride: '/r/', market: '/market/', profile: '/@',
});
export const uuidReference = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const shortReference = /^[0-9a-z]{6,8}$/;
export function parsePublicReference(reference) {
  if (typeof reference !== 'string' || reference.length > 512 || /[\s/?#\\]/.test(reference)) return null;
  if (uuidReference.test(reference)) return { legacyId: reference.toLowerCase() };
  const publicId = reference.slice(reference.lastIndexOf('-') + 1).toLowerCase();
  return shortReference.test(publicId) ? { publicId } : null;
}
// Next passes dynamic segments percent-encoded ("%D0%BC…" slugs, "%40name"
// profiles). Compare and parse the decoded value, or a canonical Unicode URL
// would redirect to itself forever.
export function routeParam(value) {
  const text = String(value ?? '');
  try { return decodeURIComponent(text); } catch { return text; }
}
export function profilePath(username) {
  return '/@' + encodeURIComponent(String(username || '').replace(/^@/, '').toLowerCase());
}
export function publicHandle(entity) {
  const publicId = entity.public_id || entity.publicId;
  if (publicId && entity.slug) return entity.slug + '-' + publicId;
  return entity.share_id || entity.shareId || '';
}
export function publicPath(kind, entity) {
  if (!Object.hasOwn(publicKinds, kind)) throw new TypeError('Unknown public entity kind');
  if (kind === 'profile') return profilePath(entity.username || entity.slug);
  return publicKinds[kind] + encodeURIComponent(publicHandle(entity));
}
export function publicOrigin(env = process.env) {
  const url = new URL(env.PUBLIC_SITE_URL || env.APP_ORIGIN || 'http://localhost:3000');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) {
    throw new Error('PUBLIC_SITE_URL must be an HTTPS origin (HTTP is allowed only for local development)');
  }
  return url.origin;
}
export function absolutePublicUrl(path, env = process.env) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('\\'))
    throw new TypeError('Expected a local absolute path');
  return new URL(path, publicOrigin(env)).href;
}
export function preserveSearch(path, params = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    for (const entry of Array.isArray(value) ? value : value == null ? [] : [value]) query.append(key, String(entry));
  return path + (query.size ? '?' + query : '');
}
