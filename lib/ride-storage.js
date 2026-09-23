import {
  mkdir,
  writeFile,
  readFile,
  unlink,
  readdir,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";
const compress = promisify(gzip),
  decompress = promisify(gunzip);
export const rideDir = () => path.resolve(/*turbopackIgnore: true*/ process.env.RIDES_DIR || "rides");
function file(id, kind) {
  if (!/^[a-f0-9-]{36}$/.test(id) || !["ride", "preview"].includes(kind))
    throw Error("Invalid storage key");
  return path.join(rideDir(), `${kind}-${id}.gpx.gz`);
}
export async function putOriginal(id, bytes, kind = "ride") {
  await mkdir(rideDir(), { recursive: true, mode: 0o700 });
  await writeFile(file(id, kind), await compress(bytes), {
    flag: "wx",
    mode: 0o600,
  });
}
export async function getOriginal(id, kind = "ride") {
  return decompress(await readFile(file(id, kind)), {
    maxOutputLength: 10 * 1024 * 1024,
  });
}
export async function removeOriginal(id, kind = "ride") {
  await unlink(file(id, kind)).catch((e) => {
    if (e.code !== "ENOENT") throw e;
  });
}
export async function cleanupRides(q) {
  await q.query("DELETE FROM ride_previews WHERE expires_at<now()");
  const rows = (await q.query("SELECT id,kind FROM ride_file_gc LIMIT 500"))
    .rows;
  for (const r of rows) {
    await removeOriginal(r.id, r.kind);
    await q.query("DELETE FROM ride_file_gc WHERE id=$1 AND kind=$2", [
      r.id,
      r.kind,
    ]);
  }
  // Crash-created orphan files are collected only after a 24-hour grace period.
  for (const name of await readdir(/*turbopackIgnore: true*/ rideDir()).catch(() => [])) {
    const m = /^(ride|preview)-([a-f0-9-]{36})\.gpx\.gz$/.exec(name);
    if (!m) continue;
    const info = await stat(file(m[2], m[1])).catch(() => null);
    if (!info || Date.now() - info.mtimeMs < 86400000) continue;
    const exists = await q.query(
      `SELECT 1 FROM ${m[1] === "ride" ? "rides" : "ride_previews"} WHERE id=$1`,
      [m[2]],
    );
    if (!exists.rows.length) await removeOriginal(m[2], m[1]);
  }
}
