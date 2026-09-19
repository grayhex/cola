import { readFile } from "node:fs/promises";
import { randomUUID, randomBytes } from "node:crypto";
import { hashPassword } from "../lib/password.js";
import { insertBike, ownedBike } from "../lib/repository.js";
import { saveFactorySpecification } from "../lib/factory-import.js";
import { parseGpx } from "../lib/ride-gpx.js";
import { previewRide, saveRide, rideSettings } from "../lib/rides.js";
const marker = "Тестовый профиль покатушек ColaBike · hagsy_test";
export async function seedHagsyRide(q, bytes, category = "road") {
  const parsed = parseGpx(bytes);
  const spec = JSON.parse(
    await readFile(
      new URL("./giant-tourer-demo.json", import.meta.url),
      "utf8",
    ),
  );

  await q.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('cola-hagsy-demo',0))",
  );
  let user = (
    await q.query(
      "SELECT id,bio FROM users WHERE username='hagsy_test' FOR UPDATE",
    )
  ).rows[0];
  if (user && user.bio !== marker)
    throw Error(
      "hagsy_test already exists and is not this demo account; refusing to modify it",
    );
  if (!user) {
    user = { id: randomUUID() };
    await q.query(
      "INSERT INTO users(id,email,name,password_hash,username,bio) VALUES($1,'hagsy_test@example.invalid','hagsy_test',$2,'hagsy_test',$3)",
      [user.id, await hashPassword(randomBytes(32).toString("hex")), marker],
    );
  }
  const existing = (
    await q.query(
      "SELECT id,share_id FROM rides WHERE owner_id=$1 AND source_hash=$2",
      [user.id, parsed.sourceHash],
    )
  ).rows[0];
  if (existing) return { id: existing.id, shareId: existing.share_id };
  let bike = (
    await q.query(
      "SELECT * FROM bikes WHERE owner_id=$1 AND manufacturer_url=$2 ORDER BY created_at LIMIT 1",
      [user.id, spec.source.url],
    )
  ).rows[0];
  if (!bike) {
    const id = await insertBike(q, user.id, {
      name: "Giant Tourer GTS",
      brand: "Giant",
      model: "Tourer",
      trim: "GTS",
      year: 2024,
      category: category,
      description:
        "Городской велосипед. Комплектация по VeloPort; источник противоречиво описывает тормоза, требуется проверка владельцем.",
      color: "",
      size: "",
      weight: null,
      is_public: true,
      manufacturer_url: spec.source.url,
    });
    bike = await ownedBike(q, id, user.id);
    await saveFactorySpecification(q, bike, user.id, spec, true);
  }
  const config = await rideSettings(q),
    preview = await previewRide(q, user.id, bytes, config);
  return saveRide(
    q,
    user.id,
    {
      previewId: preview.previewId,
      bikeId: bike.id,
      title: "Покатушка 16 сентября",
      description: "Тестовая покатушка из GPX Zepp на Giant Tourer GTS.",
      isPublic: true,
      privacyEnabled: true,
      privacyRadiusM: 500,
    },
    config,
  );
}
