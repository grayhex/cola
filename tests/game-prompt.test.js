import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { getGameImagePrompt, saveGameImagePrompt } from "../lib/game-prompt.js";
import { gameImagePromptInput, gameImagePromptLimit } from "../lib/game-prompt-validation.js";
import { getGameSettings } from "../lib/gamification.js";

test("image prompt accepts bounded plain text, empty reset, Unicode and newlines but no coercion or controls", () => {
  for (const prompt of ["", "  Style\n<svg> & «велосипед» 🏆\t", "Я".repeat(gameImagePromptLimit)])
    assert.equal(gameImagePromptInput.parse({ prompt }).prompt, prompt);
  for (const input of [{}, { prompt: null }, { prompt: 5 }, { prompt: "", unexpected: true },
    { prompt: "x".repeat(gameImagePromptLimit + 1) }, { prompt: "a\u0000b" }])
    assert.equal(gameImagePromptInput.safeParse(input).success, false);
});

test("private image prompt persists across database restart, preserves rules and settings, and rechecks admin rights", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cola-game-prompt-"));
  let q = new PGlite(dir);
  const admin = randomUUID(), regular = randomUUID();
  const prompt = '<script>alert("text only")</script>\nСтиль ColaBike 🏆';
  try {
    for (const file of (await readdir(new URL("../db", import.meta.url))).filter((f) => f.endsWith(".sql")).sort())
      await q.exec(await readFile(new URL("../db/" + file, import.meta.url), "utf8"));
    await q.query("INSERT INTO users(id,email,name,password_hash,username,role) VALUES($1,'admin@example.test','Admin','hash','prompt_admin','admin'),($2,'user@example.test','User','hash','prompt_user','user')", [admin, regular]);
    const rules = (await q.query("SELECT * FROM game_rules ORDER BY key")).rows;
    const settings = await getGameSettings(q);
    assert.deepEqual(await q.transaction((tx) => getGameImagePrompt(tx, admin)), { prompt: "" });
    for (const fn of [getGameImagePrompt, saveGameImagePrompt])
      await assert.rejects(() => q.transaction((tx) => fn(tx, regular, { prompt })), (e) => e.status === 403);
    await q.transaction((tx) => saveGameImagePrompt(tx, admin, { prompt }));
    await q.close();
    q = new PGlite(dir);
    assert.deepEqual(await q.transaction((tx) => getGameImagePrompt(tx, admin)), { prompt });
    assert.deepEqual(await getGameSettings(q), settings);
    assert.deepEqual((await q.query("SELECT * FROM game_rules ORDER BY key")).rows, rules);
    assert.equal((await q.query("SELECT count(*)::int AS n FROM achievement_awards")).rows[0].n, 0);
    const audits = (await q.query("SELECT action,target FROM admin_audit")).rows;
    assert.deepEqual(audits, [{ action: "gamification.image_prompt", target: "1" }]);
    await q.query("UPDATE users SET blocked=true WHERE id=$1", [admin]);
    await assert.rejects(() => q.transaction((tx) => saveGameImagePrompt(tx, admin, { prompt: "no" })), (e) => e.status === 403);
    await q.query("UPDATE users SET blocked=false,role='user' WHERE id=$1", [admin]);
    await assert.rejects(() => q.transaction((tx) => getGameImagePrompt(tx, admin)), (e) => e.status === 403);
    await q.query("UPDATE users SET role='admin' WHERE id=$1", [admin]);
    await q.transaction((tx) => saveGameImagePrompt(tx, admin, { prompt: "" }));
    assert.deepEqual(await q.transaction((tx) => getGameImagePrompt(tx, admin)), { prompt: "" });
  } finally { await q.close(); await rm(dir, { recursive: true, force: true }); }
});
