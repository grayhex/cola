import { classificationWhere } from "./classification-sql.js";
import { cardBadges, records } from "./gamification.js";
import { notify } from "./notifications.js";
import { visibleCommentCount } from "./comments.js";
import { publicAuthor } from "./profile-dto.js";
import { publicSocial } from "./public-dto.js";
import { hydrate } from "./repository.js";
import { scoreBike, defaultScoring } from "./bike-score.js";
import { getSite } from "./site.js";
export async function decorateBike(
  q,
  bike,
  viewerId,
  site,
  publicView = false,
) {
  const full = await hydrate(q, bike, publicView);
  const author = await q.query(
    "SELECT id,username,name,avatar_id FROM users WHERE id=$1 AND blocked=false",
    [bike.owner_id],
  );
  const likes = await q.query(
    "SELECT count(*)::int AS count,coalesce(bool_or(l.user_id=$2),false) AS liked,(" +
      visibleCommentCount.replaceAll("b.id", "$1") +
      ") AS comments FROM bike_likes l JOIN users u ON u.id=l.user_id WHERE l.bike_id=$1 AND u.blocked=false",
    [bike.id, viewerId || null],
  );
  const social = {
    author: author.rows[0] || null,
    isOwner: viewerId === bike.owner_id,
    likes: likes.rows[0].count,
    liked: likes.rows[0].liked,
    comments: likes.rows[0].comments,
    scores: scoreBike(
      full,
      site.settings.scoring || defaultScoring,
      site.catalog.componentGroups,
    ),
  };
  return publicView
    ? publicSocial(full, social)
    : {
        ...full,
        author: publicAuthor(social.author),
        is_owner: social.isOwner,
        likes: social.likes,
        liked: social.liked,
        comments: social.comments,
        scores: social.scores,
      };
}
// A bike page: guests and other riders get the public DTO; editing fields
// and hidden prices go to the signed-in owner only.
export async function visibleBike(q, shareId, viewerId, site) {
  const { rows } = await q.query(
    "SELECT b.* FROM bikes b JOIN users u ON u.id=b.owner_id WHERE b.share_id=$1 AND (b.is_public=true OR b.owner_id=$2) AND u.blocked=false",
    [shareId, viewerId || null],
  );
  return rows[0]
    ? decorateBike(q, rows[0], viewerId, site, rows[0].owner_id !== viewerId)
    : null;
}
export async function showcase(
  q,
  viewerId,
  {
    page = 1,
    category = "",
    classification = {},
    search = "",
    ownerId = null,
    followingId = null,
    sort = "new",
    ids: selectedIds = null,
  } = {},
) {
  const site = await getSite(q);
  const winners =
    selectedIds ||
    (sort === "records"
      ? // Bikes holding records; rides and riders hold theirs elsewhere.
        (await records(q)).records
          .filter((r) => r.holder?.kind === "bike")
          .map((r) => r.holder.id)
      : null);
  const params = [search, ownerId, followingId, winners];
  const where =
    " FROM bikes b JOIN users u ON u.id=b.owner_id WHERE b.is_public=true AND u.blocked=false AND ($2::uuid IS NULL OR b.owner_id=$2) AND ($3::uuid IS NULL OR EXISTS(SELECT 1 FROM user_follows f WHERE f.follower_id=$3 AND f.following_id=b.owner_id)) AND ($4::uuid[] IS NULL OR b.id=ANY($4)) AND ($1='' OR strpos(lower(b.name || ' ' || b.brand || ' ' || b.model || ' ' || u.name),lower($1))>0)" +
    classificationWhere(
      classification,
      params,
      category.split(",").filter(Boolean),
    );
  const count = await q.query("SELECT count(*)::int AS total" + where, params);
  // Hydrate the bike row; publicSocial below remains the explicit allowlist.
  // New ownership metadata follows the same DTO path as account/detail views.
  const result = await q.query(
    "SELECT b.*" +
      ",u.name AS author_name,u.username AS author_username,u.avatar_id AS author_avatar_id,(SELECT count(*)::int FROM bike_likes l JOIN users lu ON lu.id=l.user_id WHERE l.bike_id=b.id AND lu.blocked=false) AS likes,EXISTS(SELECT 1 FROM bike_likes l WHERE l.bike_id=b.id AND l.user_id=$" +
      (params.length + 2) +
      ") AS liked,(" +
      visibleCommentCount +
      ") AS comments" +
      where +
      " ORDER BY " +
      (followingId
        ? "b.published_at"
        : sort === "popular"
          ? "likes"
          : "b.created_at") +
      " DESC,b.id LIMIT 24 OFFSET $" +
      (params.length + 1),
    [...params, (page - 1) * 24, viewerId || null],
  );
  const ids = result.rows.map((b) => b.id);
  if (!ids.length)
    return { bikes: [], total: count.rows[0].total, page, pageSize: 24 };
  const [parts, photos, badges] = await Promise.all([
    q.query(
      "SELECT id,model_id,bike_id,section,category,name,notes,url,group_id,sort_order,price FROM components WHERE bike_id=ANY($1::uuid[]) ORDER BY sort_order,created_at,id",
      [ids],
    ),
    q.query(
      "SELECT id,bike_id,is_cover,source_page_url FROM photos WHERE bike_id=ANY($1::uuid[]) ORDER BY is_cover DESC,created_at,id",
      [ids],
    ),
    cardBadges(q, ids),
  ]);
  const index = (rows) => {
    const map = new Map(ids.map((id) => [id, []]));
    for (const row of rows) map.get(row.bike_id).push(row);
    return map;
  };
  const byPart = index(parts.rows),
    byPhoto = index(photos.rows);
  return {
    bikes: result.rows.map((b) => {
      const full = {
        ...b,
        components: byPart.get(b.id),
        photos: byPhoto.get(b.id),
      };
      return {
        ...publicSocial(full, {
          author: {
            id: b.owner_id,
            username: b.author_username,
            name: b.author_name,
            avatar_id: b.author_avatar_id,
          },
          isOwner: viewerId === b.owner_id,
          likes: b.likes,
          liked: b.liked,
          comments: b.comments,
          scores: scoreBike(
            full,
            site.settings.scoring || defaultScoring,
            site.catalog.componentGroups,
          ),
        }),
        badges: badges.get(b.id),
      };
    }),
    total: count.rows[0].total,
    page,
    pageSize: 24,
  };
}
// Caller wraps this in a transaction. Match comments and owner mutations:
// users (in ID order) -> bike. Taking the bike first can deadlock with a
// comment while notification foreign keys acquire locks on the same users.
export async function vote(q, bikeId, userId, enabled) {
  const initial = (
    await q.query("SELECT owner_id FROM bikes WHERE id=$1", [bikeId])
  ).rows[0];
  if (!initial) return { error: "Велосипед недоступен", status: 404 };
  const users = (
    await q.query(
      "SELECT id,blocked FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
      [[...new Set([initial.owner_id, userId])]],
    )
  ).rows;
  if (users.some((u) => u.blocked) || !users.some((u) => u.id === userId))
    return { error: "Пользователь недоступен", status: 404 };
  const result = await q.query(
    "SELECT b.owner_id,b.is_public,u.blocked FROM bikes b JOIN users u ON u.id=b.owner_id WHERE b.id=$1 FOR UPDATE OF b",
    [bikeId],
  );
  const b = result.rows[0];
  if (!b || !b.is_public || b.blocked)
    return { error: "Велосипед недоступен", status: 404 };
  if (b.owner_id === userId)
    return { error: "Нельзя голосовать за свой велосипед", status: 403 };
  if (enabled)
    await q.query(
      "INSERT INTO bike_likes(bike_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [bikeId, userId],
    );
  else
    await q.query("DELETE FROM bike_likes WHERE bike_id=$1 AND user_id=$2", [
      bikeId,
      userId,
    ]);
  if (enabled)
    await notify(q, {
      recipient: b.owner_id,
      actor: userId,
      type: "like",
      bike: bikeId,
    });
  const counts = await q.query(
    "SELECT count(*)::int AS count FROM bike_likes l JOIN users u ON u.id=l.user_id WHERE l.bike_id=$1 AND u.blocked=false",
    [bikeId],
  );
  return { likes: counts.rows[0].count, liked: enabled };
}
