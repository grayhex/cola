import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prepareThumbnail } from "./images.js";

// Served sizes are a closed set: arbitrary widths would let clients fill the
// cache and the CPU with unique variants.
export const mediaWidths = Object.freeze([160, 320, 640, 1280]);
// Bump when variant encoding changes so browsers and the cache refresh.
const pipeline = "v1";

// null: original; number: allowed variant; undefined: invalid request.
export function mediaWidth(value) {
  if (value === null || value === undefined || value === "") return null;
  const width = Number(value);
  return mediaWidths.includes(width) && String(width) === value
    ? width
    : undefined;
}

// Media IDs are never reused for other bytes, so ID + size identify content.
export const mediaEtag = (id, width = null) =>
  `"${pipeline}-${id}-${width || "original"}"`;

export function notModified(req, etag) {
  const header = req.headers.get("if-none-match");
  return (
    !!header &&
    header
      .split(",")
      .some((value) => value.trim().replace(/^W\//, "") === etag)
  );
}

// Private media: the browser keeps bytes but revalidates every use, so the
// server re-checks access each time and revocation applies immediately.
export const privateMediaCache = "private, no-cache";
// Site graphics are public and a new upload always gets a new ID.
export const immutableMediaCache = "public, max-age=31536000, immutable";

export function mediaResponse(
  bytes,
  etag,
  { cache = privateMediaCache, contentType = "image/webp", headers = {} } = {},
) {
  return new Response(bytes, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": cache,
      ETag: etag,
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

export function notModifiedResponse(
  etag,
  { cache = privateMediaCache, headers = {} } = {},
) {
  return new Response(null, {
    status: 304,
    headers: { "Cache-Control": cache, ETag: etag, ...headers },
  });
}

export const cacheDirectory = (env = process.env) =>
  path.resolve(
    env.MEDIA_CACHE_DIR || path.join(os.tmpdir(), "colabike-media-cache"),
  );
const variantPath = (id, width, env) =>
  path.join(cacheDirectory(env), `${pipeline}-${id}-${width}.webp`);

// Variants are derived data: built once per (ID, width), stored outside the
// backed-up photos volume by default and rebuilt after a container restart.
// Callers must check access before asking for bytes.
export async function mediaVariant(id, width, readOriginal, env = process.env) {
  if (!mediaWidths.includes(width)) throw new Error("INVALID_MEDIA_WIDTH");
  const file = variantPath(id, width, env);
  try {
    return await readFile(file);
  } catch {
    // Missing or unreadable cache entry: rebuild from the original.
  }
  const bytes = await prepareThumbnail(await readOriginal(), width);
  try {
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${randomUUID()}.tmp`;
    await writeFile(temp, bytes, { mode: 0o600 });
    await rename(temp, file);
    scheduleSweep(env);
  } catch {
    // A full or read-only cache must not break delivery: bytes are still valid.
  }
  return bytes;
}

// Best-effort removal when a photo is deleted; a restart clears the rest.
export async function purgeMediaVariants(ids, env = process.env) {
  await Promise.all(
    ids.flatMap((id) =>
      mediaWidths.map((width) =>
        rm(variantPath(id, width, env), { force: true }).catch(() => {}),
      ),
    ),
  );
}

// Keep the cache under MEDIA_CACHE_MAX_MB (default 1024) by removing the
// oldest variants. Runs at most once per 200 new files.
let writes = 0;
function scheduleSweep(env) {
  if (++writes % 200) return;
  sweepMediaCache(env).catch(() => {});
}
export async function sweepMediaCache(env = process.env) {
  const limit = (Number(env.MEDIA_CACHE_MAX_MB) || 1024) * 1024 * 1024;
  const directory = cacheDirectory(env);
  const files = [];
  for (const name of await readdir(directory)) {
    if (!name.endsWith(".webp")) continue;
    try {
      const info = await stat(path.join(directory, name));
      files.push({ name, size: info.size, mtime: info.mtimeMs });
    } catch {}
  }
  let total = files.reduce((sum, f) => sum + f.size, 0);
  if (total <= limit) return 0;
  let removed = 0;
  for (const f of files.sort((a, b) => a.mtime - b.mtime)) {
    if (total <= limit * 0.8) break;
    await rm(path.join(directory, f.name), { force: true });
    total -= f.size;
    removed++;
  }
  return removed;
}
