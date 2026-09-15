import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { preparePhoto } from "../lib/images.js";
import { PGlite } from "@electric-sql/pglite";

test("image decoding rejects SVG and arbitrary content regardless of MIME", async () => {
  await assert.rejects(
    preparePhoto(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')),
    /UNSUPPORTED_IMAGE/,
  );
  await assert.rejects(
    preparePhoto(Buffer.from("not an image")),
    /UNSUPPORTED_IMAGE/,
  );
});
import { hashPassword, verifyPassword } from "../lib/password.js";
import { bikeInput, componentInput, credentials } from "../lib/validation.js";
import {
  insertBike,
  ownedBike,
  sharedBike,
  hydrate,
} from "../lib/repository.js";

test("passwords are salted and incorrect passwords are rejected", async () => {
  const a = await hashPassword("correct horse battery");
  const b = await hashPassword("correct horse battery");
  assert.notEqual(a, b);
  assert.equal(await verifyPassword("correct horse battery", a), true);
  assert.equal(await verifyPassword("wrong", a), false);
});
test("validation rejects invalid fields and normalizes email", () => {
  assert.equal(
    credentials.parse({ email: "Test@Example.com", password: "1234567890" })
      .email,
    "test@example.com",
  );
  assert.equal(
    credentials.safeParse({ email: "a@b.com", password: "short" }).success,
    false,
  );
  assert.equal(
    componentInput.safeParse({
      section: "build",
      category: "Седло",
      name: "Brooks C17",
      notes: "",
      price: -1,
    }).success,
    false,
  );
  assert.equal(
    bikeInput.safeParse({
      name: "Bike",
      brand: "",
      model: "",
      year: 0,
      category: "road",
      description: "",
      color: "",
      size: "",
      weight: null,
    }).success,
    false,
  );
});
test("PostgreSQL schema: ownership, sharing privacy, revocation and cascading deletion", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      await readFile(new URL("../db/001_initial.sql", import.meta.url), "utf8"),
    );
    await db.exec(
      await readFile(new URL("../db/002_admin.sql", import.meta.url), "utf8"),
    );
    const owner = randomUUID(),
      other = randomUUID();
    await db.query(
      "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4),($5,$6,$7,$8)",
      [
        owner,
        "a@example.com",
        "A",
        "hash",
        other,
        "b@example.com",
        "B",
        "hash",
      ],
    );
    const id = await insertBike(db, owner, {
      name: "My Grizl",
      brand: "Canyon",
      model: "Grizl",
      year: 2025,
      category: "gravel",
      description: "",
      color: "",
      size: "M",
      weight: 10.5,
    });
    assert.equal(await ownedBike(db, id, other), null);
    const bike = await ownedBike(db, id, owner);
    assert.ok(bike);
    assert.equal(await sharedBike(db, bike.share_id), null);
    await db.query(
      "INSERT INTO components(id,bike_id,section,category,name,notes,price) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [randomUUID(), id, "build", "Седло", "Brooks C17", "", 12500],
    );
    await db.query("UPDATE bikes SET is_public=true WHERE id=$1", [id]);
    const publicView = await sharedBike(db, bike.share_id);
    assert.equal(publicView.components[0].name, "Brooks C17");
    assert.equal("price" in publicView.components[0], false);
    assert.equal("owner_id" in publicView, false);
    const privateView = await hydrate(db, bike);
    assert.equal(Number(privateView.components[0].price), 12500);
    const newShare = randomUUID();
    await db.query("UPDATE bikes SET is_public=false,share_id=$1 WHERE id=$2", [
      newShare,
      id,
    ]);
    assert.equal(await sharedBike(db, bike.share_id), null);
    await db.query("UPDATE bikes SET is_public=true WHERE id=$1", [id]);
    assert.equal(await sharedBike(db, bike.share_id), null);
    assert.ok(await sharedBike(db, newShare));
    await db.query("DELETE FROM bikes WHERE id=$1", [id]);
    assert.equal((await db.query("SELECT * FROM components")).rows.length, 0);
  } finally {
    await db.close();
  }
});
