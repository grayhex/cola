import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import type { Queryable, transaction as Transaction } from "./db.ts";
import { commitUncertain } from "./db.ts";
import { CommunityError } from "./community-validation.ts";
import { EmailPolicyError } from "./email-policy.ts";
import { errorCode } from "./errors.ts";
import {
  limits,
  QuotaError,
  componentPhotoBytes,
  clubPostPhotoBytes,
} from "./limits.ts";
import { clubPostFrom } from "./club-post-access.ts";
import { lockClubPostActor } from "./club-post-access.ts";
import { clubPostPhotoPath } from "./club-posts.ts";
const directory = () =>
  path.resolve(/*turbopackIgnore: true*/ process.env.UPLOAD_DIR || "uploads");
export async function saveClubPostPhoto(
  transaction: typeof Transaction,
  club: string,
  post: string,
  actor: string,
  request: string,
  bytes: Buffer,
) {
  const id = randomUUID(),
    filename = "clubpost-" + id + ".webp",
    hash = createHash("sha256").update(bytes).digest("hex");
  let written = false;
  try {
    return await transaction(async (q) => {
      const access = await lockClubPostActor(q, club, post, actor);
      if (access.status === "published" && !access.verified)
        throw new EmailPolicyError();
      if (access.owner_id !== actor)
        throw new CommunityError("Фото добавляет только автор", 403);
      const old = (
        await q.query<{ id: string; content_hash: string }>(
          "SELECT id,content_hash FROM club_post_photos WHERE post_id=$1 AND request_id=$2",
          [post, request],
        )
      ).rows[0];
      if (old) {
        if (old.content_hash !== hash)
          throw new CommunityError("Запрос загрузки уже использован", 409);
        return { id: old.id, url: clubPostPhotoPath(club, post, old.id) };
      }
      const usage = (
        await q.query<{ n: number; own: number }>(
          "SELECT count(*) FILTER(WHERE post_id=$2)::int n,count(*)::int own FROM club_post_photos WHERE uploader_id=$1",
          [actor, post],
        )
      ).rows[0];
      if (usage.n >= 8 || usage.own >= 240)
        throw new QuotaError(
          "Максимум 8 фото в публикации и 240 фото клубов на пользователя",
        );
      const others = (
        await q.query<{ bytes: string }>(
          `SELECT (SELECT coalesce(sum(coalesce(p.size_bytes,$2)),0) FROM photos p JOIN bikes b ON b.id=p.bike_id WHERE b.owner_id=$1)
      +(SELECT coalesce(sum(p.size_bytes),0) FROM journal_photos p JOIN journal_entries e ON e.id=p.entry_id WHERE e.owner_id=$1)
      +(SELECT coalesce(sum(p.size_bytes),0) FROM market_photos p JOIN market_listings m ON m.id=p.listing_id WHERE m.owner_id=$1)
      +(SELECT coalesce(avatar_size_bytes,0) FROM users WHERE id=$1) bytes`,
          [actor, limits.fileBytes],
        )
      ).rows[0];
      if (
        Number(others.bytes) +
          (await componentPhotoBytes(q, actor)) +
          (await clubPostPhotoBytes(q, actor)) +
          bytes.length >
        limits.storageBytes
      )
        throw new QuotaError("Лимит места для фотографий исчерпан");
      await mkdir(directory(), { recursive: true });
      const file = await open(path.join(directory(), filename), "wx");
      written = true;
      try {
        await file.writeFile(bytes);
      } finally {
        await file.close();
      }
      await q.query(
        "INSERT INTO club_post_photos(id,post_id,uploader_id,request_id,filename,size_bytes,content_hash) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [id, post, actor, request, filename, bytes.length, hash],
      );
      return { id, url: clubPostPhotoPath(club, post, id) };
    });
  } catch (error) {
    if (written && !commitUncertain(error))
      await unlink(path.join(directory(), filename)).catch(() => {});
    throw error;
  }
}
export async function deleteClubPostPhoto(
  q: Queryable,
  club: string,
  post: string,
  id: string,
  actor: string,
) {
  const access = await lockClubPostActor(q, club, post, actor);
  if (access.owner_id !== actor)
    throw new CommunityError("Фото изменяет только автор", 403);
  await q.query("DELETE FROM club_post_photos WHERE id=$1 AND post_id=$2", [
    id,
    post,
  ]);
  return { ok: true };
}
export async function clubPostPhotoFilename(
  q: Queryable,
  club: string,
  post: string,
  id: string,
  viewer: string | null,
) {
  const row = (
    await q.query<{ filename: string }>(
      `SELECT photo.filename ${clubPostFrom} JOIN club_post_photos photo ON photo.post_id=p.id LEFT JOIN users v ON v.id=$4 AND NOT v.blocked WHERE p.club_id=$1 AND p.id=$2 AND photo.id=$3 AND p.deleted_at IS NULL AND p.hidden_at IS NULL AND NOT author.blocked AND c.hidden_at IS NULL AND (c.owner_id IS NULL OR NOT co.blocked) AND (p.status='published' OR p.owner_id=v.id)`,
      [club, post, id, viewer],
    )
  ).rows[0];
  if (!row) throw new CommunityError("Фото недоступно", 404);
  return row.filename;
}
export async function readClubPostPhoto(
  q: Queryable,
  club: string,
  post: string,
  id: string,
  viewer: string | null,
) {
  const authorize = () => clubPostPhotoFilename(q, club, post, id, viewer);
  const filename = await authorize();
  let bytes: Buffer;
  try {
    bytes = await readFile(path.join(directory(), filename));
  } catch (error) {
    if (errorCode(error) === "ENOENT")
      throw new CommunityError("Фото недоступно", 404);
    throw error;
  }
  await authorize();
  return bytes;
}
export async function cleanupClubPostPhotos(
  q: Queryable,
  { orphans = false } = {},
) {
  for (const { filename } of (
    await q.query<{ filename: string }>(
      "SELECT filename FROM club_post_photo_gc ORDER BY created_at LIMIT 200",
    )
  ).rows) {
    if (!/^clubpost-[a-f0-9-]{36}\.webp$/.test(filename)) continue;
    try {
      await unlink(path.join(directory(), filename));
    } catch (error) {
      if (errorCode(error) !== "ENOENT") continue;
    }
    await q.query("DELETE FROM club_post_photo_gc WHERE filename=$1", [
      filename,
    ]);
  }
  if (!orphans) return;
  for (const filename of await readdir(directory()).catch(() => [])) {
    if (!/^clubpost-[a-f0-9-]{36}\.webp$/.test(filename)) continue;
    const file = path.join(directory(), filename),
      info = await stat(file).catch(() => null);
    if (
      info &&
      Date.now() - info.mtimeMs > 86400000 &&
      !(
        await q.query("SELECT 1 FROM club_post_photos WHERE filename=$1", [
          filename,
        ])
      ).rowCount
    )
      await unlink(file).catch((error) => {
        if (errorCode(error) !== "ENOENT") throw error;
      });
  }
}
