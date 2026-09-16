import { randomUUID } from "node:crypto";
import { factoryComponent } from "./factory-components.js";
// Caller provides a transaction. Locking makes repeated/concurrent imports idempotent.
export async function saveFactorySpecification(
  q,
  bike,
  owner,
  result,
  initializeCurrent = false,
) {
  const { rows } = await q.query(
    "SELECT * FROM bikes WHERE id=$1 AND owner_id=$2 FOR UPDATE",
    [bike.id, owner],
  );
  const current = rows[0];
  if (
    !current ||
    ["brand", "model", "trim", "year"].some((k) => current[k] !== bike[k])
  )
    return { conflict: true };
  await q.query(
    "UPDATE bikes SET factory_spec=$1,updated_at=now() WHERE id=$2",
    [result, bike.id],
  );
  let importedCount = 0;
  if (initializeCurrent) {
    const existing = await q.query(
      "SELECT id FROM components WHERE bike_id=$1 LIMIT 1",
      [bike.id],
    );
    if (!existing.rows.length)
      for (const raw of result.components) {
        const c = factoryComponent(raw);
        await q.query(
          "INSERT INTO components(id,bike_id,section,category,name,notes,price) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [randomUUID(), bike.id, c.section, c.category, c.name, c.notes, null],
        );
        importedCount++;
      }
  }
  return { importedCount };
}
