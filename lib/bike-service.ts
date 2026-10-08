import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import path from "node:path";
import type { BikeRow, ComponentRow, PhotoRow } from "./database-rows.ts";
import type { Queryable } from "./db.ts";
import { errorCode } from "./errors.ts";
import { purgeMediaVariants } from "./media-cache.ts";
import { photoFileNames } from "./photo-storage.ts";
import type { BikeInput, ComponentInput } from "./validation.ts";

// What the owner does to a bicycle, its parts and its photos: the SQL that used
// to sit in the legacy route (#333), so the site and API v1 call one place. The
// functions take the owner already checked (`ownedBike`) and keep the locks and
// their order exactly as they were: a write to the bike row serializes with the
// `FOR UPDATE` guard of ride writes.

/** The owner's own bicycles, newest first (private ones included). */
export async function ownBikeRows(q: Queryable, owner: string) {
  const { rows } = await q.query<BikeRow>(
    "SELECT * FROM bikes WHERE owner_id=$1 ORDER BY created_at DESC",
    [owner],
  );
  return rows;
}

/**
 * Saves the fields of a bicycle. The factory specification survives only while
 * the identity it was found for (brand, model, year, trim) is unchanged.
 */
export async function updateBikeRow(
  q: Queryable,
  bikeId: string,
  owner: string,
  b: BikeInput,
) {
  await q.query(
    "UPDATE bikes SET name=$1,brand=$2,model=$3,year=$4,category=$5,description=$6,color=$7,size=$8,weight=$9,trim=$12,manufacturer_url=$13,price=$14,show_bike_price=$15,show_component_prices=$16,show_accessory_prices=$17,mileage=$18,is_public=$19,purposes=$20,classification=$21,is_former=$22,factory_spec=CASE WHEN brand=$2 AND model=$3 AND year=$4 AND trim=$12 THEN factory_spec ELSE NULL END,updated_at=now() WHERE id=$10 AND owner_id=$11",
    [
      b.name,
      b.brand,
      b.model,
      b.year,
      b.category,
      b.description,
      b.color,
      b.size,
      b.weight,
      bikeId,
      owner,
      b.trim,
      b.manufacturer_url,
      b.price,
      b.show_bike_price,
      b.show_component_prices,
      b.show_accessory_prices,
      b.mileage,
      b.is_public,
      b.purposes,
      JSON.stringify(b.classification),
      b.is_former,
    ],
  );
}

/** Whether any ride still belongs to the bicycle. */
export async function bikeHasRides(q: Queryable, bikeId: string) {
  const { rowCount } = await q.query<{ "?column?": number }>(
    "SELECT 1 FROM rides WHERE bike_id=$1 LIMIT 1",
    [bikeId],
  );
  return !!rowCount;
}

/** The photo files of a bicycle: read before it is deleted, removed after. */
export async function bikePhotoFiles(q: Queryable, bikeId: string) {
  const { rows } = await q.query<{
    id: string;
    filename: string;
    original_filename: string | null;
  }>("SELECT id,filename,original_filename FROM photos WHERE bike_id=$1", [
    bikeId,
  ]);
  return rows;
}

/** Deletes the bicycle row; the database refuses while rides reference it (23503). */
export async function deleteBikeRow(
  q: Queryable,
  bikeId: string,
  owner: string,
) {
  await q.query("DELETE FROM bikes WHERE id=$1 AND owner_id=$2", [
    bikeId,
    owner,
  ]);
}

/** The order the owner shows the groups of parts in. */
export async function setGroupOrder(
  q: Queryable,
  bikeId: string,
  groups: string[],
) {
  await q.query("UPDATE bikes SET group_order=$1 WHERE id=$2", [
    JSON.stringify(groups),
    bikeId,
  ]);
}

/**
 * Publishes or withdraws the bicycle. A withdrawal rotates the share token, so
 * an old link stays dead after the bicycle is published again.
 */
export async function setBikeSharing(
  q: Queryable,
  bikeId: string,
  isPublic: boolean,
) {
  await q.query(
    "UPDATE bikes SET is_public=$1,share_id=CASE WHEN $1 THEN share_id ELSE $2 END WHERE id=$3",
    [isPublic, randomUUID(), bikeId],
  );
}

/**
 * Adds a part at the end of the list, under the lock of the bicycle row, and
 * returns its id.
 */
export async function addComponentRow(
  q: Queryable,
  bikeId: string,
  c: ComponentInput,
) {
  await q.query<{ id: string }>("SELECT id FROM bikes WHERE id=$1 FOR UPDATE", [
    bikeId,
  ]);
  const id = randomUUID();
  await q.query(
    "INSERT INTO components(id,bike_id,section,category,name,notes,price,url,group_id,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,(SELECT coalesce(max(sort_order),-1)+1 FROM components WHERE bike_id=$2))",
    [
      id,
      bikeId,
      c.section,
      c.category,
      c.name,
      c.notes,
      c.price,
      c.url,
      c.group_id,
    ],
  );
  return id;
}

/** Removes a part of this bicycle (no error when it is already gone). */
export async function deleteComponentRow(
  q: Queryable,
  bikeId: string,
  componentId: string,
) {
  await q.query("DELETE FROM components WHERE id=$1 AND bike_id=$2", [
    componentId,
    bikeId,
  ]);
}

/** One part of this bicycle as stored, or undefined. */
export async function componentRowOf(
  q: Queryable,
  bikeId: string,
  componentId: string,
) {
  const { rows } = await q.query<ComponentRow>(
    "SELECT * FROM components WHERE id=$1 AND bike_id=$2",
    [componentId, bikeId],
  );
  return rows[0];
}

/** Saves the editable fields of a part; its place in the list is not touched. */
export async function updateComponentRow(
  q: Queryable,
  bikeId: string,
  componentId: string,
  c: ComponentInput,
) {
  await q.query(
    "UPDATE components SET section=$1,category=$2,name=$3,notes=$4,price=$5,url=$8,group_id=$9 WHERE id=$6 AND bike_id=$7",
    [
      c.section,
      c.category,
      c.name,
      c.notes,
      c.price,
      componentId,
      bikeId,
      c.url,
      c.group_id,
    ],
  );
}

type Transaction = <T>(fn: (q: Queryable) => Promise<T>) => Promise<T>;

/**
 * Makes a photo the cover (`cover`) or removes it (`remove`), under the lock of
 * the bicycle row. Removing the cover hands it to the oldest remaining photo.
 * Returns the removed file names (the picture, and the original it was made of
 * when its backdrop had been taken off, #370); none when nothing was removed
 * (no such photo here, or a cover change).
 */
export async function changePhoto(
  transaction: Transaction,
  bikeId: string,
  photoId: string,
  action: "cover" | "remove",
) {
  let filenames: string[] = [];
  await transaction(async (q) => {
    await q.query<{ id: string }>(
      "SELECT id FROM bikes WHERE id=$1 FOR UPDATE",
      [bikeId],
    );
    const { rows } = await q.query<PhotoRow>(
      "SELECT * FROM photos WHERE id=$1 AND bike_id=$2",
      [photoId, bikeId],
    );
    if (!rows[0]) return;
    if (action === "cover") {
      await q.query("UPDATE photos SET is_cover=false WHERE bike_id=$1", [
        bikeId,
      ]);
      await q.query("UPDATE photos SET is_cover=true WHERE id=$1", [photoId]);
    } else {
      filenames = photoFileNames(rows[0]);
      await q.query("DELETE FROM photos WHERE id=$1", [photoId]);
      if (rows[0].is_cover)
        await q.query(
          "UPDATE photos SET is_cover=true WHERE id=(SELECT id FROM photos WHERE bike_id=$1 ORDER BY created_at,id LIMIT 1)",
          [bikeId],
        );
    }
  });
  return filenames;
}

/**
 * The bicycle of the owner, locked for the change that follows, with the exact
 * text of `updated_at` (microseconds): the version a client's `If-Match` names.
 * Undefined when the bicycle is not the owner's.
 */
export async function lockOwnBike(q: Queryable, bikeId: string, owner: string) {
  const { rows } = await q.query<BikeRow & { version: string }>(
    "SELECT *,updated_at::text AS version FROM bikes WHERE id=$1 AND owner_id=$2 FOR UPDATE",
    [bikeId, owner],
  );
  return rows[0];
}

/** The version of a bicycle as it is now: the text of `updated_at`. */
export async function bikeVersionOf(q: Queryable, bikeId: string) {
  const { rows } = await q.query<{ version: string }>(
    "SELECT updated_at::text AS version FROM bikes WHERE id=$1",
    [bikeId],
  );
  return rows[0]?.version;
}

/**
 * Deletes the bicycle with its photo files and cached variants. False when a
 * ride still belongs to it: the site does not delete a bicycle out from under
 * its rides, and the database refuses too (23503) if one appears meanwhile.
 */
export async function removeBike(
  q: Queryable,
  bikeId: string,
  owner: string,
  directory: string,
) {
  if (await bikeHasRides(q, bikeId)) return false;
  const rows = await bikePhotoFiles(q, bikeId);
  try {
    await deleteBikeRow(q, bikeId, owner);
  } catch (e) {
    if (errorCode(e) === "23503") return false;
    throw e;
  }
  await Promise.all(
    rows
      .flatMap(photoFileNames)
      .map((filename) =>
        unlink(path.join(directory, filename)).catch(() => {}),
      ),
  );
  await purgeMediaVariants(rows.map((photo) => photo.id));
  return true;
}

/** The version of a bicycle for its owner; undefined for anyone else. */
export async function ownBikeVersion(
  q: Queryable,
  bikeId: string,
  owner: string,
) {
  const { rows } = await q.query<{ version: string }>(
    "SELECT updated_at::text AS version FROM bikes WHERE id=$1 AND owner_id=$2",
    [bikeId, owner],
  );
  return rows[0]?.version;
}
