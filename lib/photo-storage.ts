import type { transaction as transactionType } from "./db.ts";
export interface PreparedPhoto {
  id: string;
  filename: string;
  bytes: Buffer;
  sourceUrl?: string | null;
  sourcePageUrl?: string | null;
}
import { commitUncertain } from "./db.ts";
import type { Queryable } from "./db.ts";
import { mkdir, open, unlink } from "node:fs/promises";
import path from "node:path";
import { checkPhotoQuota } from "./limits.ts";
// Input images have already been decoded/re-encoded. Write only after reserving quota.
export async function savePhotos(
  transaction: typeof transactionType,
  owner: string,
  bike: string,
  prepared: PreparedPhoto[],
  directory: string,
) {
  const written: string[] = [];
  try {
    await transaction(async (q: Queryable) => {
      const usage = await checkPhotoQuota(
        q,
        owner,
        bike,
        prepared.map((p) => p.bytes.length),
      );
      await mkdir(directory, { recursive: true });
      for (const [i, p] of prepared.entries()) {
        const handle = await open(path.join(directory, p.filename), "wx");
        written.push(p.filename);
        try {
          await handle.writeFile(p.bytes);
        } finally {
          await handle.close();
        }
        await q.query(
          "INSERT INTO photos(id,bike_id,filename,is_cover,source_url,source_page_url,size_bytes) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            p.id,
            bike,
            p.filename,
            usage.bike_count === 0 && i === 0,
            p.sourceUrl || null,
            p.sourcePageUrl || null,
            p.bytes.length,
          ],
        );
      }
    });
  } catch (e) {
    if (!commitUncertain(e))
      await Promise.all(
        written.map((f) => unlink(path.join(directory, f)).catch(() => {})),
      );
    throw e;
  }
}

/** Every file a stored photo holds: the picture, and the original behind it (#370). */
export const photoFileNames = (photo: {
  filename: string;
  original_filename?: string | null;
}) => [
  photo.filename,
  ...(photo.original_filename ? [photo.original_filename] : []),
];
