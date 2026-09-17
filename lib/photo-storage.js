import { mkdir, open, unlink } from "node:fs/promises";
import path from "node:path";
import { checkPhotoQuota } from "./limits.js";
// Input images have already been decoded/re-encoded. Write only after reserving quota.
export async function savePhotos(
  transaction,
  owner,
  bike,
  prepared,
  directory,
) {
  const written = [];
  try {
    await transaction(async (q) => {
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
    if (!e.commitUncertain)
      await Promise.all(
        written.map((f) => unlink(path.join(directory, f)).catch(() => {})),
      );
    throw e;
  }
}
