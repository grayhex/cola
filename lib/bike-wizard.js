import { z } from "zod";
import { randomUUID } from "node:crypto";
import { bikeInput, componentInput, uuid } from "./validation.js";
import { insertBike } from "./repository.js";
export const wizardInput = z.object({
  requestId: uuid,
  previewId: uuid.nullable().optional(),
  bike: bikeInput,
  components: z.array(componentInput).max(200),
});
export async function createWizardBike(q, owner, input) {
  await q.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    "wizard:" + input.requestId,
  ]);
  const previous = await q.query(
    "SELECT bike_id,owner_id FROM wizard_submissions WHERE id=$1",
    [input.requestId],
  );
  if (previous.rows.length) {
    if (previous.rows[0].owner_id !== owner)
      throw new Error("REQUEST_CONFLICT");
    return { id: previous.rows[0].bike_id, repeated: true };
  }
  let factory = null;
  if (input.previewId) {
    const preview = await q.query(
      "SELECT response FROM resolver_previews WHERE id=$1 AND owner_id=$2 AND expires_at>now()",
      [input.previewId, owner],
    );
    factory = preview.rows[0]?.response;
    if (
      !factory ||
      ["brand", "model", "year", "trim"].some(
        (k) => String(factory.query[k] || "") !== String(input.bike[k] || ""),
      )
    )
      throw new Error("PREVIEW_EXPIRED");
  }
  const id = await insertBike(q, owner, input.bike);
  await q.query("UPDATE bikes SET factory_spec=$1 WHERE id=$2", [factory, id]);
  for (const [i, c] of input.components.entries())
    await q.query(
      "INSERT INTO components(id,bike_id,section,category,name,notes,price,url,group_id,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        randomUUID(),
        id,
        c.section,
        c.category,
        c.name,
        c.notes,
        c.price,
        c.url,
        c.group_id,
        i,
      ],
    );
  await q.query(
    "INSERT INTO wizard_submissions(id,owner_id,bike_id) VALUES($1,$2,$3)",
    [input.requestId, owner, id],
  );
  return { id, repeated: false };
}
