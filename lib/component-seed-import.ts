import { createHash } from "node:crypto";
import type { Queryable, transaction as transactionType } from "./db.ts";
import type { ComponentModelRow } from "./database-rows.ts";
import type {
  CatalogSeedBatch,
  CatalogSeedEntry,
} from "./component-catalog-seed.ts";
import { audit } from "./site.ts";
import { componentActor } from "./component-access.ts";
import { requireVerifiedEmail } from "./email-policy.ts";
import { partLandingPath } from "./experience-catalog.ts";
import {
  componentPhotoCapacity,
  persistPreparedComponentPhotos,
  cleanComponentPhotoWrites,
  type PreparedComponentPhoto,
} from "./component-photos.ts";

export const seedHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const seedPhotoId = (batch: string, key: string, sha: string) => {
  const h = seedHash([batch, key, sha]);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
export interface SeedActor {
  id: string;
  username: string;
  role: string;
  email_verified_at: Date | null;
  blocked: boolean;
}
export async function findSeedActor(
  q: Queryable,
  username?: string,
): Promise<SeedActor> {
  const { rows } = await q.query<SeedActor>(
    `SELECT id,username,role,email_verified_at,blocked FROM users
     WHERE ($1::text IS NOT NULL AND lower(username)=lower($1))
       OR ($1::text IS NULL AND role='admin' AND NOT blocked AND email_verified_at IS NOT NULL)
     ORDER BY id LIMIT 2`,
    [username || null],
  );
  if (rows.length !== 1)
    throw new Error("Specify one existing verified administrator with --actor");
  const actor = rows[0];
  if (actor.blocked || actor.role !== "admin")
    throw new Error("Catalog seed requires an active administrator");
  requireVerifiedEmail(actor);
  return actor;
}
async function assertActor(q: Queryable, id: string, lock = false) {
  if (lock) {
    const actor = await componentActor(q, { id }, true);
    if (actor.role !== "admin")
      throw new Error("Catalog seed requires an administrator");
  } else {
    const row = (
      await q.query<SeedActor>(
        "SELECT id,username,role,email_verified_at,blocked FROM users WHERE id=$1",
        [id],
      )
    ).rows[0];
    if (!row || row.blocked || row.role !== "admin")
      throw new Error("Catalog seed requires an active administrator");
    requireVerifiedEmail(row);
  }
}
interface Journal {
  batch: string;
  seed_key: string;
  entry_sha256: string;
  state: "created" | "filled" | "reused" | "conflict" | "rejected";
  model_id: string | null;
  reason: string;
  photo_ids: string[];
  after_model: Record<string, unknown> | null;
  rolled_back_at: Date | null;
  batch_rolled_back_at?: Date | null;
}
interface Model extends ComponentModelRow {
  snapshot: Record<string, unknown>;
}
async function getModel(q: Queryable, id: string) {
  return (
    await q.query<Model>(
      "SELECT m.*,to_jsonb(m) snapshot FROM component_models m WHERE id=$1",
      [id],
    )
  ).rows[0];
}
export interface SeedPlanEntry {
  seedKey: string;
  entryHash: string;
  action: "new" | "fill-empty" | "reuse" | "conflict" | "rejected" | "already";
  modelId: string | null;
  name: string;
  path: string | null;
  reason: string;
  photo: "add" | "preserve" | "none";
  preserved: string[];
  signature: string;
}
export interface SeedPlan {
  batch: string;
  sha256: string;
  actorId: string;
  entries: SeedPlanEntry[];
}
async function priorEntry(q: Queryable, batch: string, key: string) {
  return (
    await q.query<Journal>(
      `SELECT e.*,b.rolled_back_at batch_rolled_back_at FROM component_seed_entries e
    JOIN component_seed_batches b ON b.batch=e.batch WHERE e.seed_key=$2
    ORDER BY (e.batch=$1) DESC,e.created_at DESC,e.batch LIMIT 1`,
      [batch, key],
    )
  ).rows[0];
}
async function planEntry(
  q: Queryable,
  batch: string,
  entry: CatalogSeedEntry,
): Promise<SeedPlanEntry> {
  const result: SeedPlanEntry = {
    seedKey: entry.seedKey,
    entryHash: seedHash(entry),
    action: "new",
    modelId: null,
    name: entry.name,
    path: null,
    reason: "",
    photo: "none",
    preserved: [],
    signature: "",
  };
  const finish = (state: unknown = null) => ({
    ...result,
    signature: seedHash([result, state]),
  });
  if (entry.status !== "approved") {
    result.action = "rejected";
    result.reason = entry.status;
    return finish();
  }
  const previous = await priorEntry(q, batch, entry.seedKey);
  if (previous) {
    result.modelId = previous.model_id;
    if (
      previous.entry_sha256 !== result.entryHash ||
      previous.rolled_back_at ||
      previous.batch_rolled_back_at
    ) {
      result.action = "conflict";
      result.reason =
        "Seed key has a different approved revision or was rolled back";
    } else if (previous.batch === batch) {
      result.action = "already";
      result.reason = previous.state;
    } else if (["conflict", "rejected"].includes(previous.state)) {
      result.action = "conflict";
      result.reason =
        "Previous batch did not admit this identity; review is still required";
    } else {
      result.action = "reuse";
      result.reason = "Previously journaled seed; preserve subsequent edits";
    }
    if (result.modelId) {
      const model = await getModel(q, result.modelId);
      if (model) result.path = partLandingPath(model.category_slug, model.slug);
    }
    return finish([
      previous.batch,
      previous.entry_sha256,
      previous.state,
      previous.rolled_back_at,
    ]);
  }
  const names = [entry.name, ...entry.aliases];
  const { rows: matches } = await q.query<{
    name: string;
    model_id: string | null;
    canonical_name: string;
    admissible: boolean;
    direct: boolean;
    merged: boolean;
  }>(
    `SELECT a.name,l.*,EXISTS(SELECT 1 FROM component_model_names n
       WHERE n.category_key=component_key($1) AND n.name_key=component_key(a.name)) direct, EXISTS(SELECT 1 FROM component_model_names n JOIN component_models m ON m.id=n.model_id WHERE n.category_key=component_key($1) AND n.name_key=component_key(a.name) AND m.merged_into IS NOT NULL) merged
     FROM unnest($2::text[]) a(name) CROSS JOIN LATERAL component_seed_lookup($1,a.name) l`,
    [entry.category, names],
  );
  const ids = [
    ...new Set(
      matches.map((m) => m.model_id).filter((id): id is string => id !== null),
    ),
  ];
  const canonical = matches[0].canonical_name;
  if (
    matches.some((m) => !m.admissible || m.merged) ||
    ids.length > 1 ||
    matches.some(
      (m) =>
        !m.model_id &&
        m.canonical_name !== m.name &&
        m.canonical_name !== canonical,
    )
  ) {
    result.action = "conflict";
    result.reason =
      "Conflicting full-name aliases, alias cycle or SQL admission rejection";
    return finish(matches);
  }
  result.modelId = ids[0] || null;
  const model = result.modelId ? await getModel(q, result.modelId) : null;
  if (
    model &&
    (model.archived ||
      !model.first_public_at ||
      model.merged_into ||
      model.category !== entry.category ||
      (model.brand && model.brand !== entry.brand))
  ) {
    result.action = "conflict";
    result.reason =
      "Existing identity is private, archived, merged or has conflicting category/brand";
    return finish([matches, model.snapshot]);
  }
  result.name = model?.name || canonical;
  if (model) result.path = partLandingPath(model.category_slug, model.slug);
  else {
    const p = (
      await q.query<{ category: string; slug: string; occupied: boolean }>(
        `SELECT component_slug($1) category,component_slug($2) slug,EXISTS(
       SELECT 1 FROM component_model_urls WHERE category_slug=component_slug($1) AND slug=component_slug($2)) occupied`,
        [entry.category, canonical],
      )
    ).rows[0];
    result.path = partLandingPath(
      p.category,
      p.slug + (p.occupied ? "-{new-uuid}" : ""),
    );
  }
  const gallery = model
    ? (
        await q.query<{ count: number }>(
          `SELECT count(*)::int count FROM component_photos p JOIN component_models m ON m.id=p.model_id WHERE coalesce(m.merged_into,m.id)=$1`,
          [model.id],
        )
      ).rows[0].count
    : 0;
  result.photo =
    entry.photo.status === "ready" ? (gallery ? "preserve" : "add") : "none";
  if (model) {
    if (model.description && model.description !== entry.description)
      result.preserved.push("description");
    if (model.cover_photo_id || gallery)
      result.preserved.push("gallery/cover/moderation");
    if (model.name !== entry.name) result.preserved.push("name/URL");
    const fills =
      (!model.description && !!entry.description) ||
      !model.brand ||
      matches.some((m) => !m.direct) ||
      result.photo === "add";
    result.action = fills ? "fill-empty" : "reuse";
  }
  return finish([matches, model?.snapshot || null, gallery]);
}
export async function planCatalogSeed(
  q: Queryable,
  batch: CatalogSeedBatch,
  sha256: string,
  actorId: string,
): Promise<SeedPlan> {
  await assertActor(q, actorId);
  const release = (
    await q.query<{ bundle_sha256: string; rolled_back_at: Date | null }>(
      "SELECT bundle_sha256,rolled_back_at FROM component_seed_batches WHERE batch=$1",
      [batch.batch],
    )
  ).rows[0];
  if (release && (release.bundle_sha256 !== sha256 || release.rolled_back_at))
    throw new Error("Batch SHA-256 changed or batch was rolled back");
  const entries: SeedPlanEntry[] = [];
  for (const entry of batch.entries)
    entries.push(await planEntry(q, batch.batch, entry));
  const photos = entries.filter((e) => e.photo === "add");
  if (photos.length) {
    const bytes = batch.entries.reduce(
      (n, entry) =>
        n +
        (photos.some((p) => p.seedKey === entry.seedKey) &&
        entry.photo.status === "ready"
          ? entry.photo.bytes
          : 0),
      0,
    );
    // Aggregate account quota, including all images scheduled by this dry run.
    await componentPhotoCapacity(q, null, actorId, photos.length, bytes);
  }
  return { batch: batch.batch, sha256, actorId, entries };
}
export interface SeedBackup {
  file: string;
  sha256: string;
  bytes: number;
  createdAt: string;
}
export async function applyCatalogSeed(
  transaction: typeof transactionType,
  batch: CatalogSeedBatch,
  plan: SeedPlan,
  backup: SeedBackup,
  media: ReadonlyMap<string, PreparedComponentPhoto>,
) {
  if (
    batch.batch !== plan.batch ||
    batch.entries.length !== plan.entries.length ||
    batch.entries.some(
      (e, i) =>
        e.seedKey !== plan.entries[i].seedKey ||
        seedHash(e) !== plan.entries[i].entryHash,
    )
  )
    throw new Error("Plan does not describe this exact package");
  await transaction(async (q) => {
    await assertActor(q, plan.actorId, true);
    await q.query("SELECT pg_advisory_xact_lock(145,0)");
    const previous = (
      await q.query<{ bundle_sha256: string; rolled_back_at: Date | null }>(
        "SELECT bundle_sha256,rolled_back_at FROM component_seed_batches WHERE batch=$1",
        [batch.batch],
      )
    ).rows[0];
    if (
      previous &&
      (previous.bundle_sha256 !== plan.sha256 || previous.rolled_back_at)
    )
      throw new Error("Batch SHA-256 changed or batch was rolled back");
    const inserted = await q.query(
      "INSERT INTO component_seed_batches(batch,bundle_sha256,actor_id,backup) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
      [batch.batch, plan.sha256, plan.actorId, backup],
    );
    if (inserted.rowCount)
      await audit(q, plan.actorId, "component_seed.apply", batch.batch);
  });
  const outcomes: {
    seedKey: string;
    state: string;
    modelId: string | null;
    reason: string;
  }[] = [];
  for (const [index, entry] of batch.entries.entries()) {
    const written: string[] = [];
    try {
      const outcome = await transaction(async (q) => {
        await assertActor(q, plan.actorId, true);
        await q.query("SELECT pg_advisory_xact_lock(145,0)");
        const release = (
          await q.query<{ rolled_back_at: Date | null }>(
            "SELECT rolled_back_at FROM component_seed_batches WHERE batch=$1",
            [batch.batch],
          )
        ).rows[0];
        if (!release || release.rolled_back_at)
          throw new Error("Batch is inactive or rolled back");
        const known = (
          await q.query<Journal>(
            "SELECT * FROM component_seed_entries WHERE batch=$1 AND seed_key=$2",
            [batch.batch, entry.seedKey],
          )
        ).rows[0];
        if (known) {
          if (known.entry_sha256 !== seedHash(entry))
            throw new Error("Previously journaled entry changed");
          return {
            seedKey: entry.seedKey,
            state: "already",
            modelId: known.model_id,
            reason: known.state,
          };
        }
        const current = await planEntry(q, batch.batch, entry);
        let state: Journal["state"] =
          current.action === "new"
            ? "created"
            : current.action === "fill-empty"
              ? "filled"
              : current.action === "rejected"
                ? "rejected"
                : current.action === "conflict"
                  ? "conflict"
                  : "reused";
        let reason = current.reason;
        if (current.signature !== plan.entries[index].signature) {
          state = "conflict";
          reason = "Catalog changed after dry run; preserve concurrent edits";
        }
        let modelId = current.modelId;
        const before = modelId
          ? (await getModel(q, modelId))?.snapshot || null
          : null;
        const photoIds: string[] = [];
        const seededPreviously = await priorEntry(
          q,
          batch.batch,
          entry.seedKey,
        );
        if (state !== "conflict" && state !== "rejected" && !seededPreviously) {
          if (state === "created") {
            modelId = (
              await q.query<{ id: string | null }>(
                "SELECT component_model_assign($1,$2) id",
                [entry.category, entry.name],
              )
            ).rows[0].id;
            if (!modelId)
              throw new Error("Shared catalog admission rejected entry");
            await q.query(
              "UPDATE component_models SET first_public_at=now(),description=$2,updated_at=now() WHERE id=$1",
              [modelId, entry.description || ""],
            );
          }
          if (!modelId) throw new Error("Missing catalog identity");
          let aliases = 0;
          for (const name of [entry.name, ...entry.aliases]) {
            const inserted = await q.query(
              "INSERT INTO component_model_names(category_key,name_key,model_id) VALUES(component_key($1),component_key($2),$3) ON CONFLICT DO NOTHING",
              [entry.category, name, modelId],
            );
            aliases += inserted.rowCount || 0;
          }
          if (state !== "created")
            await q.query(
              `UPDATE component_models SET
            description=CASE WHEN description='' THEN $2 ELSE description END,
            brand=CASE WHEN brand='' THEN $3 ELSE brand END,version=version+1,updated_at=now()
            WHERE id=$1 AND ((description='' AND $2<>'') OR brand='' OR $4::boolean)`,
              [modelId, entry.description || "", entry.brand, aliases > 0],
            );
          if (current.photo === "add") {
            const prepared = media.get(entry.seedKey);
            if (
              !prepared ||
              entry.photo.status !== "ready" ||
              prepared.id !==
                seedPhotoId(batch.batch, entry.seedKey, entry.photo.sha256) ||
              prepared.bytes.length !== entry.photo.bytes ||
              prepared.width !== entry.photo.width ||
              prepared.height !== entry.photo.height ||
              seedHash(prepared.source) !== seedHash(entry.photo.source) ||
              createHash("sha256").update(prepared.bytes).digest("hex") !==
                entry.photo.sha256
            )
              throw new Error("Missing or changed prepared media");
            await persistPreparedComponentPhotos(
              q,
              modelId,
              plan.actorId,
              [prepared],
              written,
              true,
            );
            photoIds.push(prepared.id);
          }
        }
        const after = modelId
          ? (await getModel(q, modelId))?.snapshot || null
          : null;
        await q.query(
          `INSERT INTO component_seed_entries(batch,seed_key,entry_sha256,state,model_id,reason,before_model,after_model,photo_ids)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            batch.batch,
            entry.seedKey,
            seedHash(entry),
            state,
            modelId,
            reason,
            before,
            after,
            photoIds,
          ],
        );
        return { seedKey: entry.seedKey, state, modelId, reason };
      });
      outcomes.push(outcome);
    } catch (error) {
      await cleanComponentPhotoWrites(written, error);
      throw error;
    }
  }
  await transaction(async (q) => {
    await assertActor(q, plan.actorId, true);
    await q.query("SELECT pg_advisory_xact_lock(145,0)");
    await q.query(
      "UPDATE component_seed_batches SET completed_at=now() WHERE batch=$1 AND completed_at IS NULL AND rolled_back_at IS NULL",
      [batch.batch],
    );
  });
  return outcomes;
}

// Rollback archives only untouched and unused creations. Never deletes rows or
// media and never reverses an administrator's edit to a reused catalog model.
export async function rollbackCatalogSeed(
  transaction: typeof transactionType,
  batch: string,
  sha256: string,
  actorId: string,
) {
  return transaction(async (q) => {
    await assertActor(q, actorId, true);
    await q.query("SELECT pg_advisory_xact_lock(145,0)");
    const release = (
      await q.query<{ bundle_sha256: string }>(
        "SELECT bundle_sha256 FROM component_seed_batches WHERE batch=$1",
        [batch],
      )
    ).rows[0];
    if (!release || release.bundle_sha256 !== sha256)
      throw new Error("Unknown batch or SHA-256 mismatch");
    const { rows } = await q.query<{ id: string }>(
      `UPDATE component_models m SET archived=true,version=version+1,updated_at=now()
      FROM component_seed_entries e WHERE e.batch=$1 AND e.state='created' AND e.model_id=m.id
      AND e.rolled_back_at IS NULL AND to_jsonb(m)=e.after_model
      AND NOT EXISTS(SELECT 1 FROM components c WHERE c.model_id=m.id)
      AND NOT EXISTS(SELECT 1 FROM component_comments c WHERE c.model_id=m.id)
      AND NOT EXISTS(SELECT 1 FROM journal_entries j WHERE j.components @> jsonb_build_array(jsonb_build_object('model_id',m.id)))
      AND NOT EXISTS(SELECT 1 FROM market_listings l WHERE l.component_model_id=m.id)
      AND NOT EXISTS(SELECT 1 FROM component_photos p WHERE p.model_id=m.id AND (NOT p.id=ANY(e.photo_ids) OR p.version<>1 OR p.hidden))
      RETURNING m.id`,
      [batch],
    );
    if (rows.length)
      await q.query(
        "UPDATE component_seed_entries SET rolled_back_at=now() WHERE batch=$1 AND model_id=ANY($2::uuid[]) AND rolled_back_at IS NULL",
        [batch, rows.map((r) => r.id)],
      );
    await q.query(
      "UPDATE component_seed_batches SET rolled_back_at=coalesce(rolled_back_at,now()) WHERE batch=$1",
      [batch],
    );
    if (rows.length) await audit(q, actorId, "component_seed.rollback", batch);
    return { archived: rows.map((r) => r.id) };
  });
}

/** Read-only correspondence report. Later editorial changes are visible, never repaired. */
export async function verifyCatalogSeed(
  q: Queryable,
  batch: CatalogSeedBatch,
  sha256: string,
  actorId: string,
) {
  await assertActor(q, actorId);
  const release = (
    await q.query<{
      bundle_sha256: string;
      completed_at: Date | null;
      rolled_back_at: Date | null;
    }>(
      "SELECT bundle_sha256,completed_at,rolled_back_at FROM component_seed_batches WHERE batch=$1",
      [batch.batch],
    )
  ).rows[0];
  if (
    !release ||
    release.bundle_sha256 !== sha256 ||
    !release.completed_at ||
    release.rolled_back_at
  )
    throw new Error("Batch incomplete, rolled back or SHA-256 mismatch");
  const rows = [];
  for (const entry of batch.entries) {
    const journal = (
      await q.query<Journal>(
        "SELECT * FROM component_seed_entries WHERE batch=$1 AND seed_key=$2",
        [batch.batch, entry.seedKey],
      )
    ).rows[0];
    if (!journal || journal.entry_sha256 !== seedHash(entry))
      throw new Error("Missing or changed journal: " + entry.seedKey);
    const model = journal.model_id ? await getModel(q, journal.model_id) : null;
    const photos = (
      await q.query<{
        id: string;
        filename: string;
        source: unknown;
        size_bytes: number;
        hidden: boolean;
      }>(
        "SELECT id,filename,source,size_bytes,hidden FROM component_photos WHERE id=ANY($1::uuid[])",
        [journal.photo_ids],
      )
    ).rows;
    const missingPhotos = journal.photo_ids.filter(
      (id) => !photos.some((p) => p.id === id),
    );
    rows.push({
      seedKey: entry.seedKey,
      state: journal.state,
      reason: journal.reason,
      modelId: journal.model_id,
      path: model ? partLandingPath(model.category_slug, model.slug) : null,
      public: !!model?.first_public_at && !model.archived && !model.merged_into,
      descriptionMatches: model?.description === entry.description,
      edited:
        !!model && seedHash(model.snapshot) !== seedHash(journal.after_model),
      photos,
      missingPhotos,
    });
  }
  return { batch: batch.batch, sha256, entries: rows };
}
