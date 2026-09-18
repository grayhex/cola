import pg from "pg";
import { readdir, lstat, unlink } from "node:fs/promises";
import path from "node:path";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL }),
  directory = process.env.UPLOAD_DIR || "uploads";
try {
  await db.connect();
  const rows = await db.query(
    "SELECT filename FROM photos UNION SELECT filename FROM site_assets UNION SELECT 'avatar-' || avatar_id::text || '.webp' AS filename FROM users WHERE avatar_id IS NOT NULL",
  );
  const known = new Set(rows.rows.map((r) => r.filename));
  const files = await readdir(directory);
  let missing = 0,
    orphans = 0,
    removed = 0;
  for (const name of known)
    if (!files.includes(name)) {
      missing++;
      console.error(
        JSON.stringify({ event: "missing_photo_file", filename: name }),
      );
    }
  for (const name of files) {
    if (
      known.has(name) ||
      !/^([a-f0-9-]{36}|(?:asset|avatar)-[a-f0-9-]{36})\.webp$/.test(name)
    )
      continue;
    const file = path.join(directory, name),
      stat = await lstat(file);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      Date.now() - stat.mtimeMs < 86400000
    )
      continue;
    orphans++;
    if (process.argv.includes("--prune-orphans")) {
      await unlink(file);
      removed++;
    }
  }
  console.log(
    JSON.stringify({ event: "photo_file_audit", missing, orphans, removed }),
  );
  if (missing) process.exitCode = 1;
} finally {
  await db.end();
}
