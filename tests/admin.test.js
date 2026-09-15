import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { settingsInput, catalogInput } from "../lib/admin-validation.js";
import { defaultSettings, defaultCatalog } from "../lib/site-defaults.js";
import { getSite, updateManagedUser } from "../lib/site.js";
import { iconPaths, categoryIcons } from "../lib/part-icons.js";
test("settings validate safe themes, fonts, color, assets and copy; every seeded category has an icon", () => {
  assert.ok(settingsInput.safeParse(defaultSettings).success);
  assert.ok(catalogInput.safeParse(defaultCatalog).success);
  assert.equal(
    settingsInput.safeParse({
      ...defaultSettings,
      accent: "red;body{display:none}",
    }).success,
    false,
  );
  assert.equal(
    settingsInput.safeParse({
      ...defaultSettings,
      logoId: "https://evil.example",
    }).success,
    false,
  );
  assert.equal(
    settingsInput.safeParse({ ...defaultSettings, font: "injected" }).success,
    false,
  );
  assert.equal(
    catalogInput.safeParse({
      ...defaultCatalog,
      manufacturers: ["Shimano", "Shimano"],
    }).success,
    false,
  );
  for (const c of [
    ...defaultCatalog.partCategories.build,
    ...defaultCatalog.partCategories.accessories,
  ])
    assert.ok(iconPaths[categoryIcons[c]], c);
});
test("upgrade preserves existing users and bikes; settings persist and protect admin roles", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      await readFile(new URL("../db/001_initial.sql", import.meta.url), "utf8"),
    );
    const first = randomUUID(),
      second = randomUUID(),
      bike = randomUUID();
    await db.query(
      "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)",
      [first, "first@example.test", "Owner", "hash"],
    );
    await db.query(
      "INSERT INTO bikes(id,owner_id,name,year,category,share_id) VALUES($1,$2,$3,2025,$4,$5)",
      [bike, first, "Existing bike", "gravel", randomUUID()],
    );
    await db.exec(
      await readFile(new URL("../db/002_admin.sql", import.meta.url), "utf8"),
    );
    assert.equal(
      (await db.query("SELECT name FROM bikes WHERE id=$1", [bike])).rows[0]
        .name,
      "Existing bike",
    );
    assert.equal(
      (await db.query("SELECT role FROM users WHERE id=$1", [first])).rows[0]
        .role,
      "user",
    );
    await db.query("INSERT INTO site_settings(id,value) VALUES(1,$1)", [
      JSON.stringify(defaultSettings),
    ]);
    await db.query("INSERT INTO site_catalog(id,value) VALUES(1,$1)", [
      JSON.stringify(defaultCatalog),
    ]);
    const value = {
      ...defaultSettings,
      theme: "dark",
      font: "system",
      copy: { "Мой гараж": "Коллекция" },
    };
    await db.query(
      "UPDATE site_settings SET value=$1,version=version+1 WHERE id=1",
      [JSON.stringify(value)],
    );
    const restored = await getSite(db);
    assert.equal(restored.settings.theme, "dark");
    assert.equal(restored.settings.copy["Мой гараж"], "Коллекция");
    assert.equal(restored.settingsVersion, 2);
    await db.query("UPDATE users SET role='admin' WHERE id=$1", [first]);
    const denied = await updateManagedUser(db, first, first, {
      name: "Owner",
      email: "first@example.test",
      role: "user",
      blocked: false,
    });
    assert.equal(denied.status, 409);
    await db.query(
      "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)",
      [second, "second@example.test", "Second", "hash"],
    );
    await db.query(
      "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES('test-session',$1,now()+interval '1 day')",
      [second],
    );
    assert.equal(
      (
        await updateManagedUser(db, first, second, {
          name: "Second",
          email: "second@example.test",
          role: "user",
          blocked: true,
        })
      ).ok,
      true,
    );
    assert.equal(
      (await db.query("SELECT * FROM sessions WHERE user_id=$1", [second])).rows
        .length,
      0,
    );
    assert.equal(
      (await db.query("SELECT blocked FROM users WHERE id=$1", [second]))
        .rows[0].blocked,
      true,
    );
    assert.equal((await db.query("SELECT * FROM admin_audit")).rows.length, 1);
  } finally {
    await db.close();
  }
});
