import { randomUUID } from "node:crypto";
import { mkdir, open, unlink } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { preparePhoto } from "./images.js";
import { limits, QuotaError } from "./limits.js";
export const avatarFilename = (id) => "avatar-" + id + ".webp";
export async function prepareAvatar(bytes) {
  // Reuse signature/pixel-limit checks; both encodings discard input metadata.
  const safe = await preparePhoto(bytes);
  return sharp(safe)
    .resize(512, 512, { fit: "cover" })
    .webp({ quality: 85 })
    .toBuffer();
}
export async function replaceAvatar(transaction, owner, bytes, directory) {
  const id = bytes ? randomUUID() : null,
    filename = id ? avatarFilename(id) : null;
  let old,
    written = false;
  try {
    await transaction(async (q) => {
      const row = (
        await q.query(
          "SELECT avatar_id FROM users WHERE id=$1 AND NOT blocked FOR UPDATE",
          [owner],
        )
      ).rows[0];
      if (!row) throw new QuotaError("Пользователь недоступен");
      old = row.avatar_id;
      if (bytes) {
        const usage = (
          await q.query(
            "SELECT coalesce(sum(coalesce(p.size_bytes,$2)),0)::bigint AS bytes FROM photos p JOIN bikes b ON b.id=p.bike_id WHERE b.owner_id=$1",
            [owner, limits.fileBytes],
          )
        ).rows[0];
        if (Number(usage.bytes) + bytes.length > limits.storageBytes)
          throw new QuotaError("Лимит места для фотографий исчерпан");
        await mkdir(directory, { recursive: true });
        const file = await open(path.join(directory, filename), "wx");
        written = true;
        try {
          await file.writeFile(bytes);
        } finally {
          await file.close();
        }
      }
      await q.query(
        "UPDATE users SET avatar_id=$2,avatar_size_bytes=$3 WHERE id=$1",
        [owner, id, bytes?.length || 0],
      );
    });
  } catch (e) {
    if (written && !e.commitUncertain)
      await unlink(path.join(directory, filename)).catch(() => {});
    throw e;
  }
  if (old)
    await unlink(path.join(directory, avatarFilename(old))).catch(() => {});
  return { avatar: id ? "/api/avatars/" + id : null };
}
