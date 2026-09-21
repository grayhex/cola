import { randomUUID } from "node:crypto";
import { mkdir, open, unlink, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { limits, QuotaError } from "./limits.js";
import { CommunityError } from "./community-validation.js";
import { journalBikeLock, journalPublic } from "./journal.js";
const directory = () => path.resolve(process.env.UPLOAD_DIR || "uploads");
export async function cleanupJournalPhotos(q, { orphans = false } = {}) {
  const rows = (
    await q.query(
      "SELECT filename FROM journal_photo_gc ORDER BY created_at LIMIT 200",
    )
  ).rows;
  for (const { filename } of rows) {
    if (!/^journal-[a-f0-9-]{36}\.webp$/.test(filename)) continue;
    try {
      await unlink(path.join(directory(), filename));
    } catch (e) {
      if (e.code !== "ENOENT") continue;
    }
    await q.query("DELETE FROM journal_photo_gc WHERE filename=$1", [filename]);
  }
  if (!orphans) return;
  // Grace period keeps in-flight uploads safe; scan only our exact filename namespace.
  for (const filename of await readdir(directory()).catch(() => [])) {
    if (!/^journal-[a-f0-9-]{36}\.webp$/.test(filename)) continue;
    const target = path.join(directory(), filename);
    const info = await stat(target).catch(() => null);
    if (!info || Date.now() - info.mtimeMs < 86400000) continue;
    if (
      !(
        await q.query("SELECT 1 FROM journal_photos WHERE filename=$1", [
          filename,
        ])
      ).rowCount
    )
      await unlink(target).catch((e) => {
        if (e.code !== "ENOENT") throw e;
      });
  }
}
export async function saveJournalPhoto(transaction, entry, user, bytes) {
  const id = randomUUID(),
    filename = "journal-" + id + ".webp";
  let written = false;
  try {
    await transaction(async (q) => {
      const e = (
        await q.query(
          "SELECT bike_id FROM journal_entries WHERE id=$1 AND owner_id=$2",
          [entry, user],
        )
      ).rows[0];
      if (!e) throw new CommunityError("Запись недоступна", 404);
      await journalBikeLock(q, e.bike_id, user);
      if (
        !(
          await q.query(
            "SELECT id FROM journal_entries WHERE id=$1 AND owner_id=$2 FOR UPDATE",
            [entry, user],
          )
        ).rowCount
      )
        throw new CommunityError("Запись недоступна", 404);
      const usage = (
        await q.query(
          `SELECT count(*)::int n,coalesce(sum(p.size_bytes),0)::bigint bytes,count(*) FILTER(WHERE p.entry_id=$2)::int entry_count FROM journal_photos p JOIN journal_entries e ON e.id=p.entry_id WHERE e.owner_id=$1`,
          [user, entry],
        )
      ).rows[0];
      const other = (
        await q.query(
          "SELECT coalesce(sum(coalesce(p.size_bytes,$2)),0)::bigint bytes FROM photos p JOIN bikes b ON b.id=p.bike_id WHERE b.owner_id=$1",
          [user, limits.fileBytes],
        )
      ).rows[0];
      const avatar = (
        await q.query("SELECT avatar_size_bytes FROM users WHERE id=$1", [user])
      ).rows[0].avatar_size_bytes;
      if (usage.entry_count >= 8 || usage.n >= 240)
        throw new QuotaError(
          "Максимум 8 фото в записи и 240 фото журнала на владельца",
        );
      if (
        Number(usage.bytes) +
          Number(other.bytes) +
          Number(
            (
              await q.query(
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
    if (written && !e.commitUncertain)
      await unlink(path.join(directory(), filename)).catch(() => {});
    throw e;
  }
  return { id, url: "/api/journal/media/" + id };
}
export async function readJournalPhoto(q, id, user = null) {
  const p = (
    await q.query(
      `SELECT p.filename FROM journal_photos p JOIN journal_entries e ON e.id=p.entry_id JOIN bikes b ON b.id=e.bike_id JOIN users u ON u.id=e.owner_id WHERE p.id=$1 AND NOT u.blocked AND (e.owner_id=$2 OR (${journalPublic}))`,
      [id, user],
    )
  ).rows[0];
  if (!p) throw new CommunityError("Изображение недоступно", 404);
  try {
    return await readFile(path.join(directory(), p.filename));
  } catch (e) {
    if (e.code === "ENOENT")
      throw new CommunityError("Изображение недоступно", 404);
    throw e;
  }
}
