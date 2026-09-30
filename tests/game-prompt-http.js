import assert from "node:assert/strict";
import { gameImagePromptLimit } from "../lib/game-prompt-validation.ts";

export async function exerciseGamePrompt(admin, guest, regular, q, adminId) {
  const endpoint = "game/admin/image-prompt";
  const original = (
    await q.query("SELECT value FROM gamification_settings WHERE id=1")
  ).rows[0].value;
  const rules = (await q.query("SELECT * FROM game_rules ORDER BY key")).rows;
  const awards = (await q.query("SELECT * FROM achievement_awards ORDER BY id"))
    .rows;
  const prompt =
    'PrivatePrompt176 <script>alert("text")</script>\nЕдиный стиль 🏆';
  try {
    assert.deepEqual((await admin(endpoint)).body, {
      prompt: original.imagePrompt || "",
    });
    for (const method of ["GET", "PUT"]) {
      assert.equal(
        (
          await guest(
            endpoint,
            method,
            method === "PUT" ? { prompt } : undefined,
          )
        ).status,
        401,
      );
      assert.equal(
        (
          await regular(
            endpoint,
            method,
            method === "PUT" ? { prompt } : undefined,
          )
        ).status,
        403,
      );
    }
    assert.equal(
      (await admin(endpoint, "PUT", { prompt }, "https://evil.test")).status,
      403,
    );
    assert.equal((await admin(endpoint, "PUT", { prompt }, "")).status, 403);
    for (const input of [
      {},
      { prompt: null },
      { prompt: "\u0000" },
      { prompt, settings: {} },
      { prompt: "x".repeat(gameImagePromptLimit + 1) },
    ])
      assert.equal((await admin(endpoint, "PUT", input)).status, 400);
    assert.equal(
      (await admin(endpoint, "PUT", { prompt: "x".repeat(65536) })).status,
      413,
    );
    assert.equal(
      (
        await admin(endpoint, "PUT", {
          prompt: "漢".repeat(gameImagePromptLimit),
        })
      ).status,
      200,
    );
    assert.deepEqual((await admin(endpoint, "PUT", { prompt })).body, {
      prompt,
    });
    assert.deepEqual((await admin(endpoint)).body, { prompt });
    const settings = (await admin("game/admin/settings")).body;
    assert.equal(Object.hasOwn(settings, "imagePrompt"), false);
    assert.equal(
      (await admin("game/admin/settings", "PUT", settings)).status,
      200,
    );
    assert.deepEqual((await admin(endpoint)).body, { prompt });
    for (const [c, path] of [
      [guest, "site"],
      [guest, "game/records"],
      [regular, "game/me"],
    ]) {
      const response = await c(path);
      assert.equal(response.status, 200);
      assert.ok(!JSON.stringify(response.body).includes("PrivatePrompt176"));
      assert.ok(!JSON.stringify(response.body).includes("imagePrompt"));
    }
    assert.deepEqual(
      (await q.query("SELECT * FROM game_rules ORDER BY key")).rows,
      rules,
    );
    assert.deepEqual(
      (await q.query("SELECT * FROM achievement_awards ORDER BY id")).rows,
      awards,
    );
    await q.query("UPDATE users SET role='user' WHERE id=$1", [adminId]);
    assert.equal((await admin(endpoint)).status, 403);
    assert.equal(
      (await admin(endpoint, "PUT", { prompt: "forbidden" })).status,
      403,
    );
    await q.query("UPDATE users SET role='admin',blocked=true WHERE id=$1", [
      adminId,
    ]);
    assert.equal((await admin(endpoint)).status, 401);
    assert.equal(
      (await admin(endpoint, "PUT", { prompt: "forbidden" })).status,
      401,
    );
    await q.query("UPDATE users SET blocked=false WHERE id=$1", [adminId]);
    assert.deepEqual((await admin(endpoint)).body, { prompt });
    assert.deepEqual((await admin(endpoint, "PUT", { prompt: "" })).body, {
      prompt: "",
    });
  } finally {
    await q.query("UPDATE users SET role='admin',blocked=false WHERE id=$1", [
      adminId,
    ]);
    await q.query("UPDATE gamification_settings SET value=$1 WHERE id=1", [
      original,
    ]);
  }
}
