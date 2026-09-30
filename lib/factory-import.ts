import type { FactorySpec as FactorySpecType } from "./database-rows.ts";
import type { BikeRow } from "./database-rows.ts";
import type { Queryable } from "./db.ts";
import { randomUUID } from "node:crypto";
import { factoryEntries } from "./factory-components.ts";
import { factoryOrigins, assignFactoryBrand } from "./factory-provenance.ts";
import type { Resolved } from "../services/bike-resolver/src/domain.ts";
// Caller provides a transaction. Locking makes repeated/concurrent imports idempotent.
export async function saveFactorySpecification(
  q: Queryable,
  bike: BikeRow,
  owner: unknown,
  result: Resolved,
  initializeCurrent = false,
) {
  const { rows } = await q.query<BikeRow>(
    "SELECT * FROM bikes WHERE id=$1 AND owner_id=$2 FOR UPDATE",
    [bike.id, owner],
  );
  const current = rows[0];
  if (
    !current ||
    (["brand", "model", "trim", "year"] as const).some(
      (k) => current[k] !== bike[k],
    )
  )
    return { conflict: true };
  let importedCount = 0;
  const inserted = [];
  if (initializeCurrent) {
    const existing = await q.query<{ id: string }>(
      "SELECT id FROM components WHERE bike_id=$1 LIMIT 1",
      [bike.id],
    );
    if (!existing.rows.length)
      for (const { value: c, brand } of factoryEntries(result)) {
        const id = randomUUID();
        await q.query(
          "INSERT INTO components(id,bike_id,section,category,name,notes,price,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            id,
            bike.id,
            c.section,
            c.category,
            c.name,
            c.notes,
            null,
            importedCount,
          ],
        );
        await assignFactoryBrand(q, id, brand);
        inserted.push({ ...c, id });
        importedCount++;
      }
  }
  const colaImport = inserted.length
    ? { version: 1, parts: factoryOrigins(result, inserted) }
    : current.factory_spec?.colaImport;
  const spec: FactorySpecType = { ...result };
  delete spec.colaImport;
  await q.query(
    "UPDATE bikes SET factory_spec=$1,updated_at=now() WHERE id=$2",
    [{ ...spec, ...(colaImport ? { colaImport } : {}) }, bike.id],
  );
  return { importedCount };
}
