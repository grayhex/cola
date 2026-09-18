import { checkBikeQuota } from "./limits.js";
import { randomUUID } from "node:crypto";
import { publicBike } from "./validation.js";
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
  const full = { ...bike, components: components.rows, photos: photos.rows };
  return publicView ? publicBike(full) : full;
}
export async function sharedBike(db, shareId) {
  const { rows } = await db.query(
    "SELECT b.* FROM bikes b JOIN users u ON u.id=b.owner_id WHERE b.share_id=$1 AND b.is_public=true AND u.blocked=false",
    [shareId],
  );
  return rows[0] ? hydrate(db, rows[0], true) : null;
}
export async function insertBike(db, owner, b) {
  await checkBikeQuota(db, owner);
  const id = randomUUID();
  await db.query(
    "INSERT INTO bikes(id,owner_id,share_id,name,brand,model,year,category,description,color,size,weight,trim) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
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
  return id;
}
