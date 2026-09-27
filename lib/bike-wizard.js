import { z } from "zod";
import { randomUUID } from "node:crypto";
import { bikeInput, componentInput, uuid } from "./validation.js";
import { insertBike } from "./repository.js";
import { factoryOrigins, assignFactoryBrand } from "./factory-provenance.js";
import { componentIdentity } from "../services/bike-resolver/src/component-identity.js";
/** @typedef {z.infer<typeof wizardInput>} WizardInput */
export const wizardInput = z.object({
  requestId: uuid,
  previewId: uuid.nullable().optional(),
  identityConfirmed: z.boolean().default(false),
  bike: bikeInput,
  components: z.array(componentInput).max(200),
});
/** @param {WizardInput} input */
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
      ["brand", "model", "trim"].some(
        (k) => String(factory.query[k] || "") !== String(input.bike[k] || ""),
      )
    )
      throw new Error("PREVIEW_EXPIRED");
  }
  if (
    (factory?.warnings?.includes("identity_mismatch") ||
      (factory?.query?.year != null &&
        factory.query.year !== input.bike.year) ||
      (factory?.sourceYear != null &&
        factory.sourceYear !== input.bike.year)) &&
    !input.identityConfirmed
  )
    throw new Error("IDENTITY_CONFIRMATION_REQUIRED");
  const id = await insertBike(q, owner, input.bike);
  const parts = input.components.map((c) => ({ ...c, id: randomUUID() }));
  for (const [i, c] of parts.entries())
    await q.query(
      "INSERT INTO components(id,bike_id,section,category,name,notes,price,url,group_id,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        c.id,
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
  if (factory) {
    const origins = factoryOrigins(factory, parts);
    for (const part of origins)
      await assignFactoryBrand(
        q,
        part.id,
        componentIdentity(part.source)?.brand,
      );
    factory = { ...factory, colaImport: { version: 1, parts: origins } };
  }
  await q.query("UPDATE bikes SET factory_spec=$1 WHERE id=$2", [factory, id]);
  await q.query(
    "INSERT INTO wizard_submissions(id,owner_id,bike_id) VALUES($1,$2,$3)",
    [input.requestId, owner, id],
  );
  return { id, repeated: false };
}
