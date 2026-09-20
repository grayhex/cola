import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Invoked by the existing isolated gamification HTTP drill, not production.
export async function exerciseGameArtwork(admin, guest, regular, q) {
  const original = (await admin("game/admin/settings")).body;
  const imageId = randomUUID();
  try {
    await q.query("INSERT INTO site_assets(id,name,filename) VALUES($1,$2,$3)", [imageId, "Game artwork HTTP fixture", "site-" + imageId + ".webp"]);
    const value = { ...original, recordImages: { expensive: imageId }, achievementImages: { first_public: imageId, full_build: imageId } };
    assert.equal((await guest("game/admin/settings", "PUT", value)).status, 401);
    assert.equal((await regular("game/admin/settings", "PUT", value)).status, 403);
    assert.equal((await admin("game/admin/settings", "PUT", value, "https://evil.test")).status, 403);
    assert.equal((await admin("game/admin/settings", "PUT", { ...value, recordImages: { expensive: "not-a-uuid" } })).status, 400);
    assert.equal((await admin("game/admin/settings", "PUT", { ...value, recordImages: { unknown: imageId } })).status, 400);
    assert.equal((await admin("game/admin/settings", "PUT", { ...value, recordImages: { expensive: randomUUID() } })).status, 409);
    assert.equal((await admin("game/admin/settings", "PUT", value)).status, 200);
    assert.equal((await admin("game/admin/settings")).body.achievementImages.first_public, imageId);
    const hall = (await guest("game/records")).body;
    assert.equal(hall.records.find((r) => r.key === "expensive")?.imageId, imageId);
    const shelf = (await regular("game/me")).body;
    assert.equal(shelf.awards.find((a) => a.key === "first_public")?.imageId, imageId);
    assert.equal(shelf.locked.find((a) => a.key === "full_build")?.imageId, imageId);
    assert.equal((await admin("admin/assets/" + imageId, "DELETE")).status, 409);
    const { recordImages, achievementImages, ...legacy } = value;
    assert.equal((await admin("game/admin/settings", "PUT", legacy)).status, 200);
    assert.equal((await admin("game/admin/settings")).body.recordImages.expensive, imageId);
    assert.equal((await admin("game/admin/settings", "PUT", { ...value, recordImages: {}, achievementImages: {} })).status, 200);
    assert.equal((await admin("admin/assets/" + imageId, "DELETE")).status, 200);
  } finally {
    await admin("game/admin/settings", "PUT", original);
    await q.query("DELETE FROM site_assets WHERE id=$1", [imageId]);
  }
}
