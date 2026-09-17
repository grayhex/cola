import { hydrate } from "./repository.js";
import { scoreBike, defaultScoring } from "./bike-score.js";
import { getSite } from "./site.js";
export async function decorateBike(q, bike, viewerId, site, publicView = false) {
  const full = await hydrate(q, bike, publicView);
  const author = await q.query("SELECT name FROM users WHERE id=$1 AND blocked=false", [bike.owner_id]);
  const likes = await q.query("SELECT count(*)::int AS count,coalesce(bool_or(l.user_id=$2),false) AS liked FROM bike_likes l JOIN users u ON u.id=l.user_id WHERE l.bike_id=$1 AND u.blocked=false", [bike.id, viewerId || null]);
  return { ...full, author: author.rows[0]?.name || "", is_owner: viewerId === bike.owner_id,
    likes: likes.rows[0].count, liked: likes.rows[0].liked,
    scores: scoreBike(full, site.settings.scoring || defaultScoring, site.catalog.componentGroups) };
}
export async function showcase(q, viewerId, { page = 1, category = "", search = "" } = {}) {
  const site = await getSite(q);
  const where = " FROM bikes b JOIN users u ON u.id=b.owner_id WHERE b.is_public=true AND u.blocked=false AND ($1='' OR b.category=$1) AND ($2='' OR strpos(lower(b.name || ' ' || b.brand || ' ' || b.model || ' ' || u.name),lower($2))>0)";
  const params = [category, search];
  const count = await q.query("SELECT count(*)::int AS total" + where, params);
  const result = await q.query("SELECT b.*" + where + " ORDER BY b.created_at DESC,b.id LIMIT 24 OFFSET $3", [...params, (page-1)*24]);
  return { bikes: await Promise.all(result.rows.map(b => decorateBike(q,b,viewerId,site,true))), total: count.rows[0].total, page, pageSize: 24 };
}
// Caller wraps this in a transaction. The row lock serializes votes with visibility changes/deletion.
export async function vote(q, bikeId, userId, enabled) {
  const result = await q.query("SELECT b.owner_id,b.is_public,u.blocked FROM bikes b JOIN users u ON u.id=b.owner_id WHERE b.id=$1 FOR UPDATE OF b", [bikeId]);
  const b = result.rows[0];
  if (!b || !b.is_public || b.blocked) return { error: "Велосипед недоступен", status: 404 };
  if (b.owner_id === userId) return { error: "Нельзя голосовать за свой велосипед", status: 403 };
  if (enabled) await q.query("INSERT INTO bike_likes(bike_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [bikeId,userId]);
  else await q.query("DELETE FROM bike_likes WHERE bike_id=$1 AND user_id=$2", [bikeId,userId]);
  const counts = await q.query("SELECT count(*)::int AS count FROM bike_likes l JOIN users u ON u.id=l.user_id WHERE l.bike_id=$1 AND u.blocked=false", [bikeId]);
  return { likes: counts.rows[0].count, liked: enabled };
}
