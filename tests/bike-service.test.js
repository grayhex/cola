import test, { after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  addComponentRow,
  bikeHasRides,
  bikePhotoFiles,
  changePhoto,
  componentRowOf,
  deleteBikeRow,
  deleteComponentRow,
  ownBikeRows,
  setBikeSharing,
  setGroupOrder,
  updateBikeRow,
  updateComponentRow,
} from "../lib/bike-service.ts";
import { insertBike, ownedBike } from "../lib/repository.ts";
import { bikeInput, componentInput } from "../lib/validation.ts";

// What the owner does to a bicycle, its parts and photos (#333): the SQL that
// moved out of the legacy route. The site's HTTP tests cover the route; these
// pin the service itself, against the owner rule and the locks' result.

const root = fileURLToPath(new URL("../", import.meta.url));
const db = new PGlite();
for (const file of (await readdir(path.join(root, "db")))
  .filter((name) => name.endsWith(".sql"))
  .sort())
  await db.exec(await readFile(path.join(root, "db", file), "utf8"));
after(() => db.close());
const transaction = (fn) => db.transaction((tx) => fn(tx));

async function addUser(label) {
  const id = randomUUID();
  await db.query(
    "INSERT INTO users(id,email,name,password_hash,username) VALUES($1,$2,$3,'hash',$4)",
    [
      id,
      id + "@test.invalid",
      "Имя " + label,
      (label + "-" + id.slice(0, 8)).toLowerCase(),
    ],
  );
  return id;
}
const fields = (extra = {}) =>
  bikeInput.parse({
    name: "Bike " + randomUUID().slice(0, 6),
    brand: "Cube",
    model: "Nuroad",
    year: 2024,
    category: "gravel",
    description: "",
    color: "",
    size: "",
    weight: null,
    is_public: false,
    ...extra,
  });
const part = (extra = {}) =>
  componentInput.parse({
    section: "build",
    category: "Рама",
    name: "Frame",
    notes: "",
    price: null,
    ...extra,
  });

const owner = await addUser("owner");
const other = await addUser("other");

test("own bikes: only mine, newest first", async () => {
  const first = await insertBike(db, owner, fields({ name: "first" }));
  await db.query(
    "UPDATE bikes SET created_at=now()-interval '1 day' WHERE id=$1",
    [first],
  );
  const second = await insertBike(db, owner, fields({ name: "second" }));
  await insertBike(db, other, fields({ name: "theirs" }));
  const rows = await ownBikeRows(db, owner);
  assert.deepEqual(
    rows.map((row) => row.id),
    [second, first],
  );
  assert.ok(rows.every((row) => row.owner_id === owner));
});

test("update: the owner's bike only; the factory specification survives an unchanged identity", async () => {
  const id = await insertBike(db, owner, fields({ name: "before" }));
  const spec = JSON.stringify({ source: "fixture" });
  await db.query("UPDATE bikes SET factory_spec=$2::jsonb WHERE id=$1", [
    id,
    spec,
  ]);
  const bike = await ownedBike(db, id, owner);
  // A name change keeps the specification; a model change drops it.
  await updateBikeRow(
    db,
    id,
    owner,
    fields({
      name: "after",
      model: bike.model,
      brand: bike.brand,
      year: bike.year,
      trim: bike.trim,
    }),
  );
  let row = await ownedBike(db, id, owner);
  assert.equal(row.name, "after");
  assert.deepEqual(row.factory_spec, { source: "fixture" });
  await updateBikeRow(
    db,
    id,
    owner,
    fields({ name: "after", model: "Other model" }),
  );
  row = await ownedBike(db, id, owner);
  assert.equal(row.model, "Other model");
  assert.equal(row.factory_spec, null);
  // Somebody else's id and owner pair changes nothing.
  await updateBikeRow(db, id, other, fields({ name: "hijacked" }));
  assert.equal((await ownedBike(db, id, owner)).name, "after");
});

test("delete: rides keep the bike, photos are listed first, the database refuses a referenced row", async () => {
  const id = await insertBike(db, owner, fields());
  assert.equal(await bikeHasRides(db, id), false);
  const photo = randomUUID();
  await db.query(
    "INSERT INTO photos(id,bike_id,filename,size_bytes) VALUES($1,$2,$3,10)",
    [photo, id, photo + ".webp"],
  );
  assert.deepEqual(await bikePhotoFiles(db, id), [
    { id: photo, filename: photo + ".webp" },
  ]);
  const ride = randomUUID();
  await db.query(
    `INSERT INTO rides(id,share_id,owner_id,bike_id,title,description,status,source_kind,has_track,is_public,started_at,distance_m,point_count,public_point_count,public_geometry,privacy_enabled,privacy_radius_m,source_hash,recurrence,meeting_point,meeting_visibility,plan_passport,import_metrics)
     VALUES($1,$1,$2,$3,'r','d','completed','gpx',false,false,now(),1,2,2,'[]',true,500,$4,'none','','public','{}','{}')`,
    [ride, owner, id, "fixture-" + ride],
  );
  assert.equal(await bikeHasRides(db, id), true);
  await assert.rejects(deleteBikeRow(db, id, owner), { code: "23503" });
  await db.query("DELETE FROM rides WHERE id=$1", [ride]);
  // Another owner cannot delete it; the owner can.
  await deleteBikeRow(db, id, other);
  assert.ok(await ownedBike(db, id, owner));
  await deleteBikeRow(db, id, owner);
  assert.equal(await ownedBike(db, id, owner), null);
});

test("sharing: a withdrawal rotates the token, a publication keeps it; group order is stored", async () => {
  const id = await insertBike(db, owner, fields({ is_public: true }));
  const before = (await ownedBike(db, id, owner)).share_id;
  await setBikeSharing(db, id, true);
  assert.equal((await ownedBike(db, id, owner)).share_id, before);
  await setBikeSharing(db, id, false);
  const withdrawn = await ownedBike(db, id, owner);
  assert.equal(withdrawn.is_public, false);
  assert.notEqual(withdrawn.share_id, before);
  await setBikeSharing(db, id, true);
  assert.equal((await ownedBike(db, id, owner)).share_id, withdrawn.share_id);
  await setGroupOrder(db, id, ["wheels", "frame"]);
  assert.deepEqual((await ownedBike(db, id, owner)).group_order, [
    "wheels",
    "frame",
  ]);
});

test("parts: appended at the end, edited in place, removed; another bike's part is not found", async () => {
  const id = await insertBike(db, owner, fields());
  const elsewhere = await insertBike(db, owner, fields());
  await transaction((q) => addComponentRow(q, id, part({ name: "One" })));
  await transaction((q) =>
    addComponentRow(q, id, part({ name: "Two", price: 5 })),
  );
  await transaction((q) =>
    addComponentRow(q, elsewhere, part({ name: "Far" })),
  );
  const rows = (
    await db.query(
      "SELECT id,name,sort_order FROM components WHERE bike_id=$1 ORDER BY sort_order",
      [id],
    )
  ).rows;
  assert.deepEqual(
    rows.map((r) => [r.name, r.sort_order]),
    [
      ["One", 0],
      ["Two", 1],
    ],
  );
  const two = rows[1].id;
  const stored = await componentRowOf(db, id, two);
  assert.equal(stored.name, "Two");
  assert.equal(
    await componentRowOf(db, elsewhere, two),
    undefined,
    "a part of another bike",
  );
  await updateComponentRow(
    db,
    id,
    two,
    part({ name: "Two edited", price: 7, notes: "n" }),
  );
  const edited = await componentRowOf(db, id, two);
  assert.equal(edited.name, "Two edited");
  assert.equal(Number(edited.price), 7);
  assert.equal(edited.sort_order, 1, "the place in the list is kept");
  // Editing through another bike's id changes nothing.
  await updateComponentRow(db, elsewhere, two, part({ name: "Hijacked" }));
  assert.equal((await componentRowOf(db, id, two)).name, "Two edited");
  await deleteComponentRow(db, elsewhere, two);
  assert.ok(await componentRowOf(db, id, two));
  await deleteComponentRow(db, id, two);
  assert.equal(await componentRowOf(db, id, two), undefined);
  await deleteComponentRow(db, id, two);
});

test("photos: the cover moves on request and to the oldest after its removal", async () => {
  const id = await insertBike(db, owner, fields());
  const elsewhere = await insertBike(db, owner, fields());
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  for (const [index, photo] of ids.entries())
    await db.query(
      "INSERT INTO photos(id,bike_id,filename,is_cover,size_bytes,created_at) VALUES($1,$2,$3,$4,10,now()+make_interval(mins=>$5))",
      [photo, id, photo + ".webp", index === 0, index],
    );
  const far = randomUUID();
  await db.query(
    "INSERT INTO photos(id,bike_id,filename,is_cover,size_bytes) VALUES($1,$2,$3,true,10)",
    [far, elsewhere, far + ".webp"],
  );
  const cover = async (bike) =>
    (
      await db.query("SELECT id FROM photos WHERE bike_id=$1 AND is_cover", [
        bike,
      ])
    ).rows.map((r) => r.id);
  assert.equal(await changePhoto(transaction, id, ids[2], "cover"), undefined);
  assert.deepEqual(await cover(id), [ids[2]]);
  // Removing the cover: its file is returned, the oldest takes over.
  assert.equal(
    await changePhoto(transaction, id, ids[2], "remove"),
    ids[2] + ".webp",
  );
  assert.deepEqual(await cover(id), [ids[0]]);
  // Removing a photo that is not the cover leaves the cover alone.
  assert.equal(
    await changePhoto(transaction, id, ids[1], "remove"),
    ids[1] + ".webp",
  );
  assert.deepEqual(await cover(id), [ids[0]]);
  // A photo of another bike is not reachable through this one.
  assert.equal(await changePhoto(transaction, id, far, "remove"), undefined);
  assert.equal(await changePhoto(transaction, id, far, "cover"), undefined);
  assert.deepEqual(await cover(elsewhere), [far]);
  assert.equal(
    (await db.query("SELECT 1 FROM photos WHERE id=$1", [far])).rowCount,
    1,
  );
  // The last one can go; nothing is left to promote.
  assert.equal(
    await changePhoto(transaction, id, ids[0], "remove"),
    ids[0] + ".webp",
  );
  assert.deepEqual(await cover(id), []);
});
