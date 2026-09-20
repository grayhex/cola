import { randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";

// Stage assets only. Publishing uses the existing versioned settings save, so
// importing never overwrites another admin's settings or unrelated local edits.
export async function stageIconAssets(icons, actorId, {
  transaction,
  audit,
  dir = process.env.UPLOAD_DIR || "uploads",
  io = { mkdir, writeFile, unlink },
}) {
  const written = [];
  const assets = icons.map((icon) => ({
    id: randomUUID(), name: "ColaBike · " + icon.key, slot: icon.key,
  }));
  await io.mkdir(dir, { recursive: true });
  try {
    for (let i = 0; i < icons.length; i++) {
      const filename = path.join(dir, "site-" + assets[i].id + ".webp");
      written.push(filename);
      try { await io.writeFile(filename, icons[i].bytes, { flag: "wx" }); }
      catch (error) {
        if (error.code === "EEXIST") written.pop();
        throw error;
      }
    }
    await transaction(async (q) => {
      for (const asset of assets) {
        await q.query("INSERT INTO site_assets(id,name,filename) VALUES($1,$2,$3)",
          [asset.id, asset.name, "site-" + asset.id + ".webp"]);
      }
      await audit(q, actorId, "icon_pack.stage", String(assets.length));
    });
  } catch (error) {
    await Promise.all(written.map((filename) => io.unlink(filename).catch(() => {})));
    throw error;
  }
  return { assets, assignments: Object.fromEntries(assets.map((asset) => [asset.slot, asset.id])) };
}
