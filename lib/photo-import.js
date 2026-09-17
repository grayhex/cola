import { randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { preparePhoto } from "./images.js";
import { bikeResolverClient } from "./bike-resolver-client.js";
export async function importPhotos(
  db,
  transaction,
  bikeId,
  ownerId,
  ids,
  directory,
) {
  const prepared = [];
  try {
    for (const candidate of ids) {
      const { rows } = await db.query(
        "SELECT id FROM photo_search_candidates WHERE id=$1 AND owner_id=$2 AND expires_at>now()",
        [candidate, ownerId],
      );
      if (!rows.length)
        throw new Error("Поиск устарел. Найдите фотографии снова.");
      const photo = await bikeResolverClient.request("/v1/photos/" + candidate);
      if (
        typeof photo.data !== "string" ||
        photo.data.length > 12 * 1024 * 1024
      )
        throw new Error("Изображение слишком большое");
      const image = await preparePhoto(Buffer.from(photo.data, "base64"));
      const id = randomUUID(),
        filename = id + ".webp";
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, filename), image);
      prepared.push({ id, filename, ...photo });
    }
    await transaction(async (q) => {
      const owned = await q.query(
        "SELECT id FROM bikes WHERE id=$1 AND owner_id=$2 FOR UPDATE",
        [bikeId, ownerId],
      );
      if (!owned.rows.length) throw new Error("Велосипед не найден");
      const { rows } = await q.query(
        "SELECT count(*)::int AS n FROM photos WHERE bike_id=$1",
        [bikeId],
      );
      if (rows[0].n + prepared.length > 12)
        throw new Error("Максимум 12 фотографий");
      for (const [i, p] of prepared.entries())
        await q.query(
          "INSERT INTO photos(id,bike_id,filename,is_cover,source_url,source_page_url) VALUES($1,$2,$3,$4,$5,$6)",
          [
            p.id,
            bikeId,
            p.filename,
            rows[0].n === 0 && i === 0,
            p.sourceUrl,
            p.sourcePageUrl,
          ],
        );
    });
    return { count: prepared.length };
  } catch (e) {
    await Promise.all(
      prepared.map((p) =>
        unlink(path.join(directory, p.filename)).catch(() => {}),
      ),
    );
    if (e.code === "23505") throw new Error("Эта фотография уже добавлена");
    throw e;
  }
}
