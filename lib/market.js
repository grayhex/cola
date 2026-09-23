import { randomUUID } from "node:crypto";
import { z } from "zod";
import { listingTypeKeys } from "./market-types.js";
import { mkdir, open, readFile, unlink, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { CommunityError } from "./community-validation.js";
import { publicAuthor } from "./profile-dto.js";
import { limits } from "./limits.js";
export const listingInput = z
  .object({
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().max(6000),
    category: z.enum(["bikes", "components", "accessories"]),
    listingType: z.enum(listingTypeKeys).optional(),
    condition: z.enum(["new", "used"]),
    price: z.number().min(0).max(9999999999).nullable().default(null),
    currency: z.literal("RUB").default("RUB"),
    location: z.string().trim().max(100),
    contact: z.string().trim().max(300),
    status: z.enum(["draft", "active", "sold"]),
  })
  .strict()
  .refine((v) => v.status !== "active" || v.description.length > 0, {
    message: "Добавьте описание объявления",
    path: ["description"],
  });
export const marketPublic = "m.status='active' AND NOT u.blocked";
export const marketFrom =
  " FROM market_listings m JOIN users u ON u.id=m.owner_id";
const columns = `m.*,u.username,u.name AS author_name,u.avatar_id,(SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id) ORDER BY p.created_at,p.id),'[]') FROM market_photos p WHERE p.listing_id=m.id) photos`;
export function marketCard(r, viewer) {
  return {
    id: r.id,
    shareId: r.share_id,
    title: r.title,
    description: r.description,
    category: r.category,
    listingType: r.listing_type || "sale",
    condition: r.condition,
    price: r.price == null ? null : Number(r.price),
    currency: r.currency,
    location: r.location,
    contact: r.contact,
    status: r.status,
    createdAt: r.created_at,
    photos: r.photos,
    author: publicAuthor({
      id: r.owner_id,
      username: r.username,
      name: r.author_name,
      avatar_id: r.avatar_id,
    }),
    isOwner: r.owner_id === viewer,
  };
}
export async function marketList(
  q,
  viewer,
  { own = false, category = null, listingType = null, condition = null, page = 1, search = "", ids = null } = {},
) {
  const params = [viewer || null, category, search, ids];
  let where = ` WHERE ${own ? "m.owner_id=$1 AND NOT u.blocked" : marketPublic} AND ($1::uuid IS NULL OR $1::uuid IS NOT NULL) AND ($2::text IS NULL OR m.category=$2) AND ($3='' OR strpos(lower(m.title||' '||m.description||' '||m.location),lower($3))>0) AND ($4::uuid[] IS NULL OR m.id=ANY($4))`;
  if (listingType) {
    params.push(listingType);
    where += ` AND m.listing_type=$${params.length}`;
  }
  if (condition) {
    params.push(condition);
    where += ` AND m.condition=$${params.length}`;
  }
  const total = (
    await q.query("SELECT count(*)::int total" + marketFrom + where, params)
  ).rows[0].total;
  const rows = (
    await q.query(
      `SELECT ${columns}${marketFrom}${where} ORDER BY m.created_at DESC,m.id LIMIT 24 OFFSET $${params.length + 1}`,
      [...params, (page - 1) * 24],
    )
  ).rows;
  return {
    items: rows.map((r) => marketCard(r, viewer)),
    total,
    page,
    pageSize: 24,
  };
}
export async function marketDetail(q, share, viewer) {
  const r = (
    await q.query(
      `SELECT ${columns}${marketFrom} WHERE m.share_id=$1 AND NOT u.blocked AND (m.status IN ('active','sold') OR m.owner_id=$2)`,
      [share, viewer || null],
    )
  ).rows[0];
  if (!r) throw new CommunityError("Объявление недоступно", 404);
  return marketCard(r, viewer);
}
async function lockOwner(q, owner) {
  if (
    !(
      await q.query(
        "SELECT id FROM users WHERE id=$1 AND NOT blocked FOR UPDATE",
        [owner],
      )
    ).rowCount
  )
    throw new CommunityError("Пользователь недоступен", 403);
}
export async function saveListing(q, owner, input, id = null) {
  await lockOwner(q, owner);
  let share = randomUUID(), prior;
  if (id) {
    prior = (
      await q.query(
        "SELECT * FROM market_listings WHERE id=$1 AND owner_id=$2 FOR UPDATE",
        [id, owner],
      )
    ).rows[0];
    if (!prior) throw new CommunityError("Объявление недоступно", 404);
    share = prior.share_id;
  } else if (
    (
      await q.query(
        "SELECT count(*)::int n FROM market_listings WHERE owner_id=$1",
        [owner],
      )
    ).rows[0].n >= 100
  )
    throw new CommunityError("Максимум 100 объявлений", 409);
  // Missing intent from a legacy client preserves an existing listing's type.
  const listingType = input.listingType || prior?.listing_type || "sale";
  if (!listingTypeKeys.includes(listingType) || (input.currency && input.currency !== "RUB"))
    throw new CommunityError("Выберите тип объявления и укажите цену в рублях");
  const price = listingType === "free" ? 0 : input.price ?? null;
  const listingId = id || randomUUID();
  await q.query(
    `INSERT INTO market_listings(id,share_id,owner_id,title,description,category,condition,price,currency,location,contact,status,published_at,listing_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,CASE WHEN $12='active' THEN now() ELSE NULL END,$13)
 ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,description=EXCLUDED.description,category=EXCLUDED.category,listing_type=EXCLUDED.listing_type,condition=EXCLUDED.condition,price=EXCLUDED.price,currency=EXCLUDED.currency,location=EXCLUDED.location,contact=EXCLUDED.contact,status=EXCLUDED.status,published_at=CASE WHEN EXCLUDED.status='active' THEN coalesce(market_listings.published_at,now()) ELSE market_listings.published_at END,updated_at=now()`,
    [
      listingId,
      share,
      owner,
      input.title,
      input.description,
      input.category,
      input.condition,
      price,
      "RUB",
      input.location,
      input.contact,
      input.status,
      listingType,
    ],
  );
  return { id: listingId, shareId: share };
}
export async function deleteListing(q, id, owner) {
  await lockOwner(q, owner);
  if (
    !(
      await q.query(
        "DELETE FROM market_listings WHERE id=$1 AND owner_id=$2 RETURNING id",
        [id, owner],
      )
    ).rowCount
  )
    throw new CommunityError("Объявление недоступно", 404);
  return { ok: true };
}
const directory = () => path.resolve(process.env.UPLOAD_DIR || "uploads");
export async function saveMarketPhoto(transaction, id, owner, bytes) {
  const photo = randomUUID(),
    filename = "market-" + photo + ".webp";
  let written = false;
  try {
    await transaction(async (q) => {
      await lockOwner(q, owner);
      if (
        !(
          await q.query(
            "SELECT id FROM market_listings WHERE id=$1 AND owner_id=$2 FOR UPDATE",
            [id, owner],
          )
        ).rowCount
      )
        throw new CommunityError("Объявление недоступно", 404);
      const usage = (
        await q.query(
          `SELECT count(*)::int n,count(*) FILTER(WHERE p.listing_id=$2)::int listing,coalesce(sum(p.size_bytes),0)::bigint bytes FROM market_photos p JOIN market_listings m ON m.id=p.listing_id WHERE m.owner_id=$1`,
          [owner, id],
        )
      ).rows[0];
      const others = (
        await q.query(
          `SELECT (SELECT coalesce(sum(coalesce(p.size_bytes,$2)),0) FROM photos p JOIN bikes b ON b.id=p.bike_id WHERE b.owner_id=$1)+(SELECT coalesce(sum(p.size_bytes),0) FROM journal_photos p JOIN journal_entries e ON e.id=p.entry_id WHERE e.owner_id=$1)+(SELECT coalesce(avatar_size_bytes,0) FROM users WHERE id=$1) bytes`,
          [owner, limits.fileBytes],
        )
      ).rows[0];
      if (usage.listing >= 8 || usage.n >= 240)
        throw new CommunityError(
          "Максимум 8 фото в объявлении и 240 фото рынка",
          409,
        );
      if (
        Number(usage.bytes) + Number(others.bytes) + bytes.length >
        limits.storageBytes
      )
        throw new CommunityError("Лимит места для фото исчерпан", 409);
      await mkdir(directory(), { recursive: true });
      const file = await open(path.join(directory(), filename), "wx");
      written = true;
      try {
        await file.writeFile(bytes);
      } finally {
        await file.close();
      }
      await q.query(
        "INSERT INTO market_photos(id,listing_id,filename,size_bytes) VALUES($1,$2,$3,$4)",
        [photo, id, filename, bytes.length],
      );
    });
  } catch (e) {
    if (written && !e.commitUncertain)
      await unlink(path.join(directory(), filename)).catch(() => {});
    throw e;
  }
  return { id: photo };
}
export async function marketPhoto(q, id, viewer) {
  const p = (
    await q.query(
      `SELECT p.filename FROM market_photos p JOIN market_listings m ON m.id=p.listing_id JOIN users u ON u.id=m.owner_id WHERE p.id=$1 AND NOT u.blocked AND (m.status IN ('active','sold') OR m.owner_id=$2)`,
      [id, viewer || null],
    )
  ).rows[0];
  if (!p) throw new CommunityError("Фото недоступно", 404);
  try {
    return await readFile(path.join(directory(), p.filename));
  } catch (e) {
    if (e.code === "ENOENT") throw new CommunityError("Фото недоступно", 404);
    throw e;
  }
}
export async function removeMarketPhoto(q, id, owner) {
  await lockOwner(q, owner);
  const r = await q.query(
    "DELETE FROM market_photos p USING market_listings m WHERE p.id=$1 AND p.listing_id=m.id AND m.owner_id=$2 RETURNING p.id",
    [id, owner],
  );
  if (!r.rowCount) throw new CommunityError("Фото недоступно", 404);
  return { ok: true };
}
export async function cleanupMarketPhotos(q, { orphans = false } = {}) {
  for (const row of (
    await q.query(
      "SELECT filename FROM market_photo_gc ORDER BY created_at LIMIT 200",
    )
  ).rows) {
    if (!/^market-[a-f0-9-]{36}\.webp$/.test(row.filename)) continue;
    try {
      await unlink(path.join(directory(), row.filename));
    } catch (e) {
      if (e.code !== "ENOENT") continue;
    }
    await q.query("DELETE FROM market_photo_gc WHERE filename=$1", [
      row.filename,
    ]);
  }
  if (orphans)
    for (const filename of await readdir(directory()).catch(() => [])) {
      if (!/^market-[a-f0-9-]{36}\.webp$/.test(filename)) continue;
      const file = path.join(directory(), filename),
        info = await stat(file).catch(() => null);
      if (!info || Date.now() - info.mtimeMs < 86400000) continue;
      if (
        !(
          await q.query("SELECT 1 FROM market_photos WHERE filename=$1", [
            filename,
          ])
        ).rowCount
      )
        await unlink(file).catch((e) => {
          if (e.code !== "ENOENT") throw e;
        });
    }
}
