import type { Resolved as ResolvedType } from "../services/bike-resolver/src/domain.js";
import type { FactorySpec as FactorySpecType } from "./database-rows.ts";
import type { Queryable } from "./db.ts";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { bikeInput, componentInput, uuid } from "./validation.ts";
import { insertBike } from "./repository.ts";
import { factoryOrigins, assignFactoryBrand } from "./factory-provenance.ts";
import { componentIdentity } from "../services/bike-resolver/src/component-identity.ts";

export const wizardInput = z.object({
  requestId: uuid,
  previewId: uuid.nullable().optional(),
  identityConfirmed: z.boolean().default(false),
  bike: bikeInput,
  components: z.array(componentInput).max(200),
});

export async function createWizardBike(
  q: Queryable,
  owner: string,
  input: WizardInput,
) {
  await q.query<{ pg_advisory_xact_lock: unknown }>(
    "SELECT pg_advisory_xact_lock(hashtext($1))",
    ["wizard:" + input.requestId],
  );
  const previous = await q.query<{ bike_id: string; owner_id: string }>(
    "SELECT bike_id,owner_id FROM wizard_submissions WHERE id=$1",
    [input.requestId],
  );
  if (previous.rows.length) {
    if (previous.rows[0].owner_id !== owner)
      throw new Error("REQUEST_CONFLICT");
    return { id: previous.rows[0].bike_id, repeated: true };
  }

  let factory:
    | (ResolvedType & {
        colaImport?: {
          version: number;
          parts: ReturnType<typeof factoryOrigins>;
        };
      })
    | null = null;
  if (input.previewId) {
    const preview = await q.query<{ response: FactorySpecType | null }>(
      "SELECT response FROM resolver_previews WHERE id=$1 AND owner_id=$2 AND expires_at>now()",
      [input.previewId, owner],
    );
    const resolved = preview.rows[0]?.response;
    if (
      !resolved ||
      (["brand", "model", "trim"] as const).some(
        (k) => String(resolved.query[k] || "") !== String(input.bike[k] || ""),
      )
    )
      throw new Error("PREVIEW_EXPIRED");
    factory = resolved;
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

export type WizardInput = z.infer<typeof wizardInput>;
