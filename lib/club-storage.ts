import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { Queryable, transaction as Transaction } from "./db.ts";
import { commitUncertain } from "./db.ts";
import { CommunityError } from "./community-validation.ts";
import { errorCode } from "./errors.ts";
import { preparePhoto } from "./images.ts";
import { clubDetail, lockManagedClub, clubAudit } from "./clubs.ts";
const directory = () =>
  path.resolve(/*turbopackIgnore: true*/ process.env.UPLOAD_DIR || "uploads");
const fileName = (id: string) => "club-" + id + ".webp";
export async function prepareClubPhoto(
  bytes: Buffer,
  purpose: "logo" | "cover",
) {
  const safe = await preparePhoto(bytes, { bikePhoto: false });
  const result = await sharp(safe)
    .resize(
      purpose === "logo"
        ? { width: 512, height: 512, fit: "cover" }
        : { width: 1600, height: 640, fit: "cover" },
    )
    .webp({ quality: 85 })
    .toBuffer();
  if (result.length > 1048576)
    throw new CommunityError("Картинка слишком большая после обработки", 413);
  return result;
}
export async function replaceClubPhoto(
  transaction: typeof Transaction,
  club: string,
  user: string,
  purpose: "logo" | "cover",
  version: number,
  bytes: Buffer | null,
) {
  const id = bytes ? randomUUID() : null,
    filename = id ? fileName(id) : null;
  let written = false;
  try {
    const result = await transaction(async (q) => {
      await lockManagedClub(q, club, user, version);
      const usage = (
        await q.query<{ bytes: string }>(
          `SELECT coalesce(sum(size_bytes),0)::bigint bytes FROM club_photos WHERE uploader_id=$1 AND NOT(club_id=$2 AND purpose=$3)`,
          [user, club, purpose],
        )
      ).rows[0];
      if (Number(usage.bytes) + (bytes?.length || 0) > 16 * 1048576)
        throw new CommunityError(
          "Лимит оформления клубов: 16 МБ на пользователя",
          409,
        );
      if (bytes && filename && id) {
        await mkdir(directory(), { recursive: true });
        const file = await open(path.join(directory(), filename), "wx");
        written = true;
        try {
          await file.writeFile(bytes);
        } finally {
          await file.close();
        }
      }
      await q.query("DELETE FROM club_photos WHERE club_id=$1 AND purpose=$2", [
        club,
        purpose,
      ]);
      if (bytes && filename && id)
        await q.query(
          "INSERT INTO club_photos(id,club_id,uploader_id,purpose,filename,size_bytes) VALUES($1,$2,$3,$4,$5,$6)",
          [id, club, user, purpose, filename, bytes.length],
        );
      // Column comes from a closed server enum, never from client text.
      await q.query(
        `UPDATE clubs SET ${purpose === "logo" ? "logo_id" : "cover_id"}=$2,version=version+1,updated_at=now() WHERE id=$1`,
        [club, id],
      );
      await clubAudit(q, club, user, purpose + "_changed");
      return clubDetail(q, club, user);
    });

    return result;
  } catch (error) {
    if (written && filename && !commitUncertain(error))
      await unlink(path.join(directory(), filename)).catch(() => {});
    throw error;
  }
}
export async function readClubPhoto(q: Queryable, club: string, id: string) {
  await clubDetail(q, club);
  const photo = (
    await q.query<{ filename: string }>(
      "SELECT filename FROM club_photos WHERE club_id=$1 AND id=$2",
      [club, id],
    )
  ).rows[0];
  if (!photo) throw new CommunityError("Картинка недоступна", 404);
  const bytes = await readFile(path.join(directory(), fileName(id)));
  // Recheck after disk I/O, so a hidden club / replaced picture cannot use a cached permit.
  await clubDetail(q, club);
  if (
    !(
      await q.query("SELECT 1 FROM club_photos WHERE club_id=$1 AND id=$2", [
        club,
        id,
      ])
    ).rowCount
  )
    throw new CommunityError("Картинка недоступна", 404);
  return bytes;
}
export async function cleanupClubPhotos(
  q?: Queryable,
  { orphans = false } = {},
) {
  if (!q) return;
  for (const { filename } of (
    await q.query<{ filename: string }>(
      "SELECT filename FROM club_photo_gc ORDER BY created_at LIMIT 200",
    )
  ).rows) {
    if (!/^club-[a-f0-9-]{36}\.webp$/.test(filename)) continue;
    try {
      await unlink(path.join(directory(), filename));
    } catch (error) {
      if (errorCode(error) !== "ENOENT") continue;
    }
    await q.query("DELETE FROM club_photo_gc WHERE filename=$1", [filename]);
  }
  if (!orphans) return;
  for (const filename of await readdir(directory()).catch(() => [])) {
    if (!/^club-[a-f0-9-]{36}\.webp$/.test(filename)) continue;
    const file = path.join(directory(), filename),
      info = await stat(file).catch(() => null);
    if (
      info &&
      Date.now() - info.mtimeMs > 86400000 &&
      !(
        await q.query("SELECT 1 FROM club_photos WHERE filename=$1", [filename])
      ).rowCount
    )
      await unlink(file).catch((error) => {
        if (errorCode(error) !== "ENOENT") throw error;
      });
  }
}
