import type { transaction as transactionType } from "./db.ts";
import { errorCode } from "./errors.ts";
import { commitUncertain } from "./db.ts";
import type { Queryable } from "./db.ts";
import { randomUUID } from "node:crypto";
import { mkdir, open, unlink, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { limits, QuotaError, componentPhotoBytes } from "./limits.ts";
import { CommunityError } from "./community-validation.ts";
import { journalBikeLock, journalPublic } from "./journal.ts";
const directory = () =>
  path.resolve(/*turbopackIgnore: true*/ process.env.UPLOAD_DIR || "uploads");
export async function cleanupJournalPhotos(
  q: Queryable,
  { orphans = false } = {},
) {
  const rows = (
    await q.query<{ filename: string }>(
      "SELECT filename FROM journal_photo_gc ORDER BY created_at LIMIT 200",
    )
  ).rows;
  for (const { filename } of rows) {
    if (!/^journal-[a-f0-9-]{36}\.webp$/.test(filename)) continue;
    try {
      await unlink(/*turbopackIgnore: true*/ path.join(directory(), filename));
    } catch (e) {
      if (errorCode(e) !== "ENOENT") continue;
    }
    await q.query("DELETE FROM journal_photo_gc WHERE filename=$1", [filename]);
  }
  if (!orphans) return;
  // Grace period keeps in-flight uploads safe; scan only our exact filename namespace.
  for (const filename of await readdir(
    /*turbopackIgnore: true*/ directory(),
  ).catch(() => [])) {
    if (!/^journal-[a-f0-9-]{36}\.webp$/.test(filename)) continue;
    const target = path.join(/*turbopackIgnore: true*/ directory(), filename);
    const info = await stat(/*turbopackIgnore: true*/ target).catch(() => null);
    if (!info || Date.now() - info.mtimeMs < 86400000) continue;
    if (
      !(
        await q.query<{ "?column?": number }>(
          "SELECT 1 FROM journal_photos WHERE filename=$1",
          [filename],
        )
      ).rowCount
    )
      await unlink(target).catch((e) => {
        if (errorCode(e) !== "ENOENT") throw e;
      });
  }
}
export async function saveJournalPhoto(
  transaction: typeof transactionType,
  entry: unknown,
  user: string,
  bytes: Buffer,
) {
  const id = randomUUID(),
    filename = "journal-" + id + ".webp";
  let written = false;
  try {
    await transaction(async (q: Queryable) => {
      const e = (
        await q.query<{ bike_id: string }>(
          "SELECT bike_id FROM journal_entries WHERE id=$1 AND owner_id=$2",
          [entry, user],
        )
      ).rows[0];
      if (!e) throw new CommunityError("Запись недоступна", 404);
      await journalBikeLock(q, e.bike_id, user);
      if (
        !(
          await q.query<{ id: string }>(
            "SELECT id FROM journal_entries WHERE id=$1 AND owner_id=$2 FOR UPDATE",
            [entry, user],
          )
        ).rowCount
      )
        throw new CommunityError("Запись недоступна", 404);
      const usage = (
        await q.query<{ n: number; bytes: string; entry_count: number }>(
          `SELECT count(*)::int n,coalesce(sum(p.size_bytes),0)::bigint bytes,count(*) FILTER(WHERE p.entry_id=$2)::int entry_count FROM journal_photos p JOIN journal_entries e ON e.id=p.entry_id WHERE e.owner_id=$1`,
          [user, entry],
        )
      ).rows[0];
      const other = (
        await q.query<{ bytes: string }>(
          "SELECT coalesce(sum(coalesce(p.size_bytes,$2)),0)::bigint bytes FROM photos p JOIN bikes b ON b.id=p.bike_id WHERE b.owner_id=$1",
          [user, limits.fileBytes],
        )
      ).rows[0];
      const avatar = (
        await q.query<{ avatar_size_bytes: string }>(
          "SELECT avatar_size_bytes FROM users WHERE id=$1",
          [user],
        )
      ).rows[0].avatar_size_bytes;
      if (usage.entry_count >= 8 || usage.n >= 240)
        throw new QuotaError(
          "Максимум 8 фото в записи и 240 фото журнала на владельца",
        );
      if (
        Number(usage.bytes) +
          (await componentPhotoBytes(q, user)) +
          Number(other.bytes) +
          Number(
            (
              await q.query<{ bytes: string }>(
                "SELECT coalesce(sum(p.size_bytes),0)::bigint bytes FROM market_photos p JOIN market_listings m ON m.id=p.listing_id WHERE m.owner_id=$1",
                [user],
              )
            ).rows[0].bytes,
          ) +
          Number(avatar) +
          bytes.length >
        limits.storageBytes
      )
        throw new QuotaError("Лимит места для фотографий исчерпан");
      await mkdir(directory(), { recursive: true });
      const f = await open(path.join(directory(), filename), "wx");
      written = true;
      try {
        await f.writeFile(bytes);
      } finally {
        await f.close();
      }
      await q.query(
        "INSERT INTO journal_photos(id,entry_id,filename,size_bytes) VALUES($1,$2,$3,$4)",
        [id, entry, filename, bytes.length],
      );
    });
  } catch (e) {
    if (written && !commitUncertain(e))
      await unlink(path.join(directory(), filename)).catch(() => {});
    throw e;
  }
  return { id, url: "/api/journal/media/" + id };
}
// Access check only; the route decides between 304, a variant or the original.
export async function journalPhotoFilename(
  q: Queryable,
  id: string,
  user: string | null = null,
) {
  const p = (
    await q.query<{ filename: string }>(
      `SELECT p.filename FROM journal_photos p JOIN journal_entries e ON e.id=p.entry_id LEFT JOIN bikes b ON b.id=e.bike_id JOIN users u ON u.id=e.owner_id WHERE p.id=$1 AND NOT u.blocked AND (e.owner_id=$2 OR (${journalPublic}) OR (e.kind='article' AND e.status='published' AND e.is_public))`,
      [id, user],
    )
  ).rows[0];
  if (!p) throw new CommunityError("Изображение недоступно", 404);
  return p.filename;
}
export async function readJournalPhotoFile(filename: string) {
  try {
    return await readFile(
      /*turbopackIgnore: true*/ path.join(directory(), filename),
    );
  } catch (e) {
    if (errorCode(e) === "ENOENT")
      throw new CommunityError("Изображение недоступно", 404);
    throw e;
  }
}
export async function readJournalPhoto(
  q: Queryable,
  id: string,
  user: string | null = null,
) {
  return readJournalPhotoFile(await journalPhotoFilename(q, id, user));
}
