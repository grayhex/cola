import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { factoryCategory, factoryEntries } from "./factory-components.js";
import {
  factorySnapshot,
  sameFactoryPart,
  assignFactoryBrand,
} from "./factory-provenance.js";
import { componentIdentity } from "../services/bike-resolver/src/component-identity.js";

// Exact historical projection, used only to recognize untouched pre-#205 rows.
// Never infer ownership of a current installation from its name alone.
export function legacyFactoryPart(c) {
  const value = c.raw?.value || "";
  return {
    section:
      [
        "front_light",
        "rear_light",
        "mudguards",
        "rack",
        "kickstand",
        "bell",
        "charger",
      ].includes(c.type) ||
      /^(дополнительные аксессуары|accessories)$/i.test(c.raw?.label || "")
        ? "accessories"
        : "build",
    category: factoryCategory(c),
    name: (c.description || value).slice(0, 150),
    notes: value.length > 150 ? value.slice(0, 500) : "",
    price: null,
  };
}
function entriesFor(source, spec) {
  const direct = factoryEntries({ components: [source] });
  if (direct.some((e) => e.brand)) return direct;
  // Conflicting extraction strategies can retain a real name that lost to prose.
  const alternatives = (spec.unknownFields || [])
    .filter((f) => f.label === source.raw?.label)
    .map((f) => ({
      type: source.type,
      description: f.value,
      raw: { label: f.label, value: f.value },
      attributes: {},
    }))
    .flatMap((c) => {
      const identity = componentIdentity(c);
      /** @type {[string, typeof c][]} */
      const entries = identity ? [[identity.name, c]] : [];
      return entries;
    });
  const unique = [...new Map(alternatives).values()];
  return unique.length === 1 ? factoryEntries({ components: unique }) : direct;
}
const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

// Caller supplies ONE transaction. Apply locks users -> bikes -> catalog; no
// network, migrations, photos, journal snapshots or market references are edited.
export async function rebuildFactoryComponents(
  q,
  { apply = false, expect = "" } = {},
) {
  if (apply) {
    await q.query(
      "SELECT id FROM users WHERE id IN (SELECT owner_id FROM bikes WHERE factory_spec IS NOT NULL) ORDER BY id FOR UPDATE",
    );
    await q.query(
      "SELECT id FROM bikes WHERE factory_spec IS NOT NULL ORDER BY id FOR UPDATE",
    );
    await q.query("SELECT pg_advisory_xact_lock(145,0)");
    await q.query("SELECT id FROM component_models ORDER BY id FOR UPDATE");
  }
  const bikes = (
    await q.query(
      "SELECT id,name,factory_spec FROM bikes WHERE factory_spec IS NOT NULL ORDER BY id",
    )
  ).rows;
  const parts = (
    await q.query(
      "SELECT c.* FROM components c JOIN bikes b ON b.id=c.bike_id WHERE b.factory_spec IS NOT NULL ORDER BY c.bike_id,c.sort_order,c.id",
    )
  ).rows;
  const models = (
    await q.query(`SELECT m.*,
    EXISTS(SELECT 1 FROM component_photos p WHERE p.model_id=m.id) OR
    EXISTS(SELECT 1 FROM component_comments c WHERE c.model_id=m.id) OR
    EXISTS(SELECT 1 FROM market_listings l WHERE l.component_model_id=m.id) OR
    EXISTS(SELECT 1 FROM component_models s WHERE s.merged_into=m.id) OR
    m.merged_into IS NOT NULL OR m.version<>1 OR m.archived AS protected,
    ARRAY(SELECT c.id::text FROM components c WHERE c.model_id=m.id ORDER BY c.id) installations
    FROM component_models m ORDER BY m.id`)
  ).rows;
  const catalog =
    (await q.query("SELECT value FROM site_catalog WHERE id=1")).rows[0]
      ?.value || {};
  const actions = [],
    skipped = [],
    candidates = new Set(),
    detached = new Set();
  for (const bike of bikes) {
    const spec = bike.factory_spec,
      current = parts.filter((p) => p.bike_id === bike.id);
    const origins =
      spec.colaImport?.version === 1 ? spec.colaImport.parts : null;
    const raw = Array.isArray(spec.components) ? spec.components : [];
    for (const source of raw) {
      const old = legacyFactoryPart(source);
      for (const m of models)
        if (m.category === old.category && m.name === old.name)
          candidates.add(m.id);
    }
    for (const part of current) {
      let source;
      if (origins) {
        const origin = origins.find((o) => o.id === part.id);
        if (origin && sameFactoryPart(part, origin.snapshot))
          source = origin.source;
      } else {
        const matches = raw.filter((c) => {
          const old = legacyFactoryPart(c);
          const group =
            catalog.componentGroups?.find((g) =>
              g.categories.includes(old.category),
            )?.id || "";
          return (
            (!part.group_id || part.group_id === group) &&
            sameFactoryPart(part, { ...old, group_id: part.group_id })
          );
        });
        // Duplicate historical projections cannot safely establish provenance.
        if (
          matches.length === 1 &&
          current.filter((p) => sameFactoryPart(p, part)).length === 1
        )
          source = matches[0];
      }
      if (!source) {
        skipped.push({
          bikeId: bike.id,
          id: part.id,
          name: part.name,
          reason: "manual_or_ambiguous",
        });
        continue;
      }
      const entries = entriesFor(source, spec);
      const values = entries.map((e) => ({
        ...e.value,
        group_id: part.group_id || "",
        url: part.url || "",
      }));
      const changed = values.length !== 1 || !sameFactoryPart(part, values[0]);
      actions.push({
        bikeId: bike.id,
        id: part.id,
        before: factorySnapshot(part),
        after: values,
        entries,
        changed,
        source,
      });
      if (changed) {
        candidates.add(part.model_id);
        detached.add(part.id);
      }
    }
  }
  const removable = [],
    retained = [];
  for (const m of models.filter((m) => candidates.has(m.id))) {
    const willStillBeUsed =
      m.installations.some((id) => !detached.has(id)) ||
      actions.some((a) =>
        a.after.some((v) => v.category === m.category && v.name === m.name),
      );
    if (willStillBeUsed) continue;
    if (m.protected)
      retained.push({
        id: m.id,
        name: m.name,
        reason: "content_links_or_catalog_edit",
      });
    else removable.push({ id: m.id, name: m.name });
  }
  const fingerprint = digest({ version: 1, bikes, parts, models, catalog });
  const report = {
    version: 1,
    fingerprint,
    applied: false,
    bikes: bikes.length,
    changes: actions
      .filter((a) => a.changed)
      .map(({ bikeId, id, before, after }) => ({ bikeId, id, before, after })),
    removeModels: removable,
    retainedModels: retained,
    preservedParts: skipped,
  };
  if (!apply) return report;
  if (!expect || expect !== fingerprint)
    throw new Error(
      "REBUILD_CHANGED: run a fresh dry-run and review its fingerprint",
    );
  for (const bike of bikes) {
    const items = actions.filter((a) => a.bikeId === bike.id);
    let nextOrder =
      Math.max(
        -1,
        ...parts.filter((p) => p.bike_id === bike.id).map((p) => p.sort_order),
      ) + 1;
    const origins = [];
    for (const action of items) {
      if (!action.after.length) {
        await q.query("DELETE FROM components WHERE id=$1 AND bike_id=$2", [
          action.id,
          bike.id,
        ]);
        continue;
      }
      for (const [index, value] of action.after.entries()) {
        const id = index === 0 ? action.id : randomUUID(),
          entry = action.entries[index];
        if (index === 0 && action.changed)
          await q.query(
            "UPDATE components SET category=$2,name=$3,notes=$4,section=$5 WHERE id=$1",
            [id, value.category, value.name, value.notes, value.section],
          );
        else if (index > 0)
          await q.query(
            "INSERT INTO components(id,bike_id,section,category,name,notes,group_id,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
            [
              id,
              bike.id,
              value.section,
              value.category,
              value.name,
              value.notes,
              value.group_id,
              nextOrder++,
            ],
          );
        await assignFactoryBrand(q, id, entry.brand);
        origins.push({
          id,
          source: entry.source,
          snapshot: factorySnapshot(value),
        });
      }
    }
    // Edited and intentionally removed tracked parts are not resurrected. On the
    // next run even a manual name identical to an old factory name stays manual.
    origins.sort((a, b) => a.id.localeCompare(b.id));
    const updated = {
      ...bike.factory_spec,
      colaImport: { version: 1, parts: origins },
    };
    if (!isDeepStrictEqual(updated, bike.factory_spec))
      await q.query(
        "UPDATE bikes SET factory_spec=$2,updated_at=now() WHERE id=$1",
        [bike.id, updated],
      );
  }
  for (const m of removable) {
    await q.query("DELETE FROM component_model_names WHERE model_id=$1", [
      m.id,
    ]);
    await q.query("DELETE FROM component_model_urls WHERE model_id=$1", [m.id]);
    await q.query("DELETE FROM component_models WHERE id=$1", [m.id]);
  }
  return { ...report, applied: true };
}
