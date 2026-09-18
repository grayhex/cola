import pg from "pg";
import { lstat } from "node:fs/promises";
import path from "node:path";
const apply = process.argv.includes("--apply");
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
let failures = 0,
  updated = 0;
try {
  await db.connect();
  const owners = await db.query(
    "SELECT DISTINCT b.owner_id FROM photos p JOIN bikes b ON b.id=p.bike_id",
  );
  for (const { owner_id } of owners.rows) {
    await db.query("BEGIN");
    try {
      await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [owner_id]);
      const rows = await db.query(
        "SELECT p.id,p.filename FROM photos p JOIN bikes b ON b.id=p.bike_id WHERE b.owner_id=$1 FOR UPDATE OF p",
        [owner_id],
      );
      for (const p of rows.rows) {
        if (path.basename(p.filename) !== p.filename)
          throw new Error("Invalid stored filename");
        const stat = await lstat(
          path.join(process.env.UPLOAD_DIR || "uploads", p.filename),
        );
        if (!stat.isFile() || stat.isSymbolicLink())
          throw new Error("Invalid photo file");
        if (apply)
          await db.query("UPDATE photos SET size_bytes=$1 WHERE id=$2", [
            stat.size,
            p.id,
          ]);
        updated++;
      }
      await db.query(apply ? "COMMIT" : "ROLLBACK");
    } catch {
      await db.query("ROLLBACK");
      failures++;
      console.error(
        JSON.stringify({
          event: "photo_recalculation_failed",
          ownerId: owner_id,
        }),
      );
    }
  }
  console.log(
    JSON.stringify({
      event: "photo_recalculation",
      apply,
      checked: updated,
      failedOwners: failures,
    }),
  );
  if (failures) process.exitCode = 1;
} finally {
  await db.end();
}
