import { classificationOf } from "./bike-classification.js";
import { checkBikeQuota } from "./limits.js";
import { randomUUID } from "node:crypto";
import { publicBike } from "./validation.js";
import { getSite } from "./site.js";
import { CommunityError } from "./community-validation.js";
export async function validatePurposes(q, purposes, previous = []) {
  const { catalog } = await getSite(q);
  if (
    (purposes || []).some(
      (id) =>
        !catalog.purposes.some(
          (p) => p.id === id && (p.enabled || previous.includes(id)),
        ),
    )
  )
    throw new CommunityError("Выберите назначение из справочника");
}
export async function ownedBike(db, id, owner) {
  const { rows } = await db.query(
    "SELECT * FROM bikes WHERE id=$1 AND owner_id=$2",
    [id, owner],
  );
  return rows[0] || null;
}
export async function hydrate(db, bike, publicView = false) {
  const [components, photos] = await Promise.all([
    db.query(
      "SELECT * FROM components WHERE bike_id=$1 ORDER BY sort_order,created_at,id",
      [bike.id],
    ),
    db.query(
      "SELECT id,is_cover,source_page_url FROM photos WHERE bike_id=$1 ORDER BY is_cover DESC,created_at,id",
      [bike.id],
    ),
  ]);
  const full = { ...bike, is_former: bike.is_former === true, components: components.rows, photos: photos.rows };
  return publicView ? publicBike(full) : full;
}
export async function sharedBike(db, shareId) {
  const { rows } = await db.query(
    "SELECT b.* FROM bikes b JOIN users u ON u.id=b.owner_id WHERE b.share_id=$1 AND b.is_public=true AND u.blocked=false",
    [shareId],
  );
  return rows[0] ? hydrate(db, rows[0], true) : null;
}
/** @param {import("./validation.js").BikeInput} b */
export async function insertBike(db, owner, b) {
  await validatePurposes(db, b.purposes);
  await checkBikeQuota(db, owner);
  const id = randomUUID();
  await db.query(
    "INSERT INTO bikes(id,owner_id,share_id,name,brand,model,year,category,description,color,size,weight,trim,purposes,classification) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)",
    [
      id,
      owner,
      randomUUID(),
      b.name,
      b.brand,
      b.model,
      b.year,
      b.category,
      b.description,
      b.color,
      b.size,
      b.weight,
      b.trim || "",
      b.purposes || [],
      JSON.stringify(b.classification || classificationOf(b)),
    ],
  );
  await db.query(
    "UPDATE bikes SET manufacturer_url=$1,price=$2,show_bike_price=$3,show_component_prices=$4,show_accessory_prices=$5,mileage=$7,is_public=$8 WHERE id=$6",
    [
      b.manufacturer_url || "",
      b.price ?? null,
      b.show_bike_price || false,
      b.show_component_prices || false,
      b.show_accessory_prices || false,
      id,
      b.mileage || 0,
      b.is_public || false,
    ],
  );
  // Ordinary bikes use the schema default; the wizard and manual API share
  // this transaction, so a former bike is never briefly published as current.
  if (b.is_former)
    await db.query("UPDATE bikes SET is_former=true WHERE id=$1", [id]);
  return id;
}
