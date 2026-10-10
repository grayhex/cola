import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify, isDeepStrictEqual } from "node:util";
import {
  mkdir,
  open,
  readFile,
  lstat,
  realpath,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { db, transaction } from "../lib/db.ts";
import {
  findSeedActor,
  planCatalogSeed,
  applyCatalogSeed,
  verifyCatalogSeed,
  rollbackCatalogSeed,
  seedPhotoId,
  type SeedBackup,
} from "../lib/component-seed-import.ts";
import type { PreparedComponentPhoto } from "../lib/component-photos.ts";
import { errorMessage } from "../lib/errors.ts";
import {
  loadCatalogSeedBundle,
  defaultSeedDirectory,
  hash,
} from "./component-catalog-seed.ts";

export const releaseHash =
  "91a76b9ec197fdcadff85f75268fe93897b8a501f656753186c3c1f5722f934f";
const backupSchema = z
  .object({
    file: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z.number().int().positive(),
    createdAt: z.iso.datetime(),
  })
  .strict();
const exec = promisify(execFile);
export async function checkSeedBackup(
  value: unknown,
  directory: string,
): Promise<SeedBackup> {
  const backup = backupSchema.parse(value);
  const root = await realpath(directory);
  const info = await lstat(backup.file);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    !(await realpath(backup.file)).startsWith(root + path.sep) ||
    info.size !== backup.bytes ||
    hash(await readFile(backup.file)) !== backup.sha256
  )
    throw new Error(
      "Backup file missing, outside private storage or SHA-256 mismatch",
    );
  return backup;
}
export async function createSeedBackup(
  directory: string,
  databaseUrl: string,
): Promise<SeedBackup> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const root = await realpath(directory);
  const file = path.join(root, `component-catalog-${randomUUID()}.dump`);
  const handle = await open(file, "wx", 0o600);
  await handle.close();
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw new Error("Invalid database protocol");
  const env = {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
  };
  try {
    // Credentials travel only through the child environment, never argv or logs.
    await exec(
      "pg_dump",
      ["--format=custom", "--no-owner", "--no-acl", "--file", file],
      { env, timeout: 120_000, maxBuffer: 1_000_000 },
    );
    await exec("pg_restore", ["--list", file], {
      timeout: 30_000,
      maxBuffer: 10_000_000,
    });
    const bytes = await readFile(file);
    if (!bytes.length) throw new Error("Empty backup");
    return {
      file,
      sha256: hash(bytes),
      bytes: bytes.length,
      createdAt: new Date().toISOString(),
    };
  } catch {
    await unlink(file).catch(() => {});
    throw new Error(
      "Catalog backup or archive inspection failed; no import started",
    );
  }
}
export async function preparedSeedMedia(
  bundle: Awaited<ReturnType<typeof loadCatalogSeedBundle>>,
) {
  const media = new Map<string, PreparedComponentPhoto>();
  for (const entry of bundle.batch.entries)
    if (entry.status === "approved" && entry.photo.status === "ready") {
      const photo = entry.photo;
      const bytes = await readFile(path.join(bundle.root, photo.file));
      if (hash(bytes) !== photo.sha256)
        throw new Error("Prepared media changed after validation");
      const id = seedPhotoId(bundle.batch.batch, entry.seedKey, photo.sha256);
      media.set(entry.seedKey, {
        id,
        filename: `component-${id}.webp`,
        bytes,
        width: photo.width,
        height: photo.height,
        source: photo.source,
      });
    }
  return media;
}
export async function verifySeedFiles(
  report: Awaited<ReturnType<typeof verifyCatalogSeed>>,
  bundle: Awaited<ReturnType<typeof loadCatalogSeedBundle>>,
) {
  for (const row of report.entries) {
    // A deleted DB row is an editorial change, reported as missingPhotos.
    // A retained DB row must still point at the exact local bytes.
    const entry = bundle.batch.entries.find((e) => e.seedKey === row.seedKey);
    for (const photo of row.photos) {
      const file = path.join(
        path.resolve(process.env.UPLOAD_DIR || "uploads"),
        photo.filename,
      );
      const info = await lstat(file);
      if (
        !entry ||
        entry.photo.status !== "ready" ||
        !info.isFile() ||
        info.isSymbolicLink() ||
        hash(await readFile(file)) !== entry.photo.sha256 ||
        photo.size_bytes !== entry.photo.bytes ||
        !isDeepStrictEqual(photo.source, entry.photo.source)
      )
        throw new Error("Stored photo missing or changed: " + row.seedKey);
    }
  }
}
function printReport(
  mode: string,
  header: Record<string, unknown>,
  entries: readonly { state?: string; action?: string }[],
) {
  const counts: Record<string, number> = {};
  for (const entry of entries) {
    const key = entry.state || entry.action || "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  console.log(JSON.stringify({ mode, ...header, counts }));
  for (const entry of entries) console.log(JSON.stringify({ mode, entry }));
}
function printVerification(
  report: Awaited<ReturnType<typeof verifyCatalogSeed>>,
) {
  printReport(
    "verify",
    {
      batch: report.batch,
      sha256: report.sha256,
      publicModels: report.entries.filter((e) => e.public).length,
      matchingDescriptions: report.entries.filter((e) => e.descriptionMatches)
        .length,
      journaledPhotos: report.entries.reduce((n, e) => n + e.photos.length, 0),
      editedModels: report.entries.filter((e) => e.edited).length,
    },
    report.entries,
  );
}

export async function runCatalogImport(args: string[]) {
  const [mode, ...options] = args;
  if (
    !["validate", "dry-run", "apply", "verify", "rollback", "release"].includes(
      mode,
    )
  )
    throw new Error(
      "Usage: component-catalog-import.ts validate|dry-run|apply|verify|rollback --sha SHA [--actor username] [--directory path] [--backup-dir path]; release uses the pinned shipped package",
    );
  const flags = new Map<string, string>();
  for (let i = 0; i < options.length; i += 2) {
    if (
      !["--sha", "--actor", "--directory", "--backup-dir"].includes(
        options[i],
      ) ||
      !options[i + 1] ||
      flags.has(options[i])
    )
      throw new Error("Unknown, duplicate or incomplete option");
    flags.set(options[i], options[i + 1]);
  }
  if (mode === "release" && flags.size)
    throw new Error("Release takes only its pinned package");
  const expected = mode === "release" ? releaseHash : flags.get("--sha");
  if (!expected && mode !== "validate")
    throw new Error("Approved --sha is required");
  const bundle = await loadCatalogSeedBundle(
    flags.get("--directory") || defaultSeedDirectory,
    expected,
  );
  if (mode === "validate") {
    console.log(
      JSON.stringify({
        batch: bundle.batch.batch,
        sha256: bundle.sha256,
        ...bundle.counts,
      }),
    );
    return;
  }
  const schema = (
    await db.query<{ present: string | null }>(
      "SELECT to_regclass('component_seed_entries')::text present",
    )
  ).rows[0];
  if (!schema.present) throw new Error("Apply schema migration 064 first");
  if (mode === "release") {
    const admins = (
      await db.query<{ count: number }>(
        "SELECT count(*)::int count FROM users WHERE role='admin'",
      )
    ).rows[0].count;
    if (!admins) {
      console.log(
        "Catalog seed deferred: fresh installation needs its real administrator first. Rerun migrate after bootstrap.",
      );
      return;
    }
  }
  if (mode === "release") {
    const previous = (
      await db.query<{ rolled_back_at: Date | null }>(
        "SELECT rolled_back_at FROM component_seed_batches WHERE batch=$1",
        [bundle.batch.batch],
      )
    ).rows[0];
    if (previous?.rolled_back_at) {
      console.log("Catalog seed remains rolled back; no catalog writes.");
      return;
    }
  }
  const actor = await findSeedActor(
    db,
    flags.get("--actor") || process.env.CATALOG_SEED_ACTOR,
  );
  const session = await db.connect();
  try {
    if (["apply", "rollback", "release"].includes(mode))
      await session.query("SELECT pg_advisory_lock(146,390)");
    if (mode === "rollback") {
      console.log(
        JSON.stringify(
          await rollbackCatalogSeed(
            transaction,
            bundle.batch.batch,
            bundle.sha256,
            actor.id,
          ),
        ),
      );
      return;
    }
    if (mode !== "verify") {
      await session.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      let plan;
      try {
        plan = await planCatalogSeed(
          session,
          bundle.batch,
          bundle.sha256,
          actor.id,
        );
        await session.query("COMMIT");
      } catch (error) {
        await session.query("ROLLBACK");
        throw error;
      }
      printReport(
        "dry-run",
        {
          batch: plan.batch,
          sha256: plan.sha256,
          actorId: plan.actorId,
          plannedPhotos: plan.entries.filter((e) => e.photo === "add").length,
          packageBytes: bundle.counts.bytes,
        },
        plan.entries,
      );
      if (mode === "dry-run") return;
      const completed = (
        await db.query<{ completed_at: Date | null }>(
          "SELECT completed_at FROM component_seed_batches WHERE batch=$1",
          [bundle.batch.batch],
        )
      ).rows[0]?.completed_at;
      if (completed && plan.entries.every((e) => e.action === "already")) {
        const report = await verifyCatalogSeed(
          db,
          bundle.batch,
          bundle.sha256,
          actor.id,
        );
        await verifySeedFiles(report, bundle);
        printVerification(report);
        return;
      }
      const media = await preparedSeedMedia(bundle);
      const directory = flags.get("--backup-dir") || "/app/catalog-backups";
      const previous = (
        await db.query<{ backup: unknown }>(
          "SELECT backup FROM component_seed_batches WHERE batch=$1",
          [bundle.batch.batch],
        )
      ).rows[0];
      const backup = previous
        ? await checkSeedBackup(previous.backup, directory)
        : await createSeedBackup(directory, process.env.DATABASE_URL || "");
      const outcomes = await applyCatalogSeed(
        transaction,
        bundle.batch,
        plan,
        backup,
        media,
      );
      printReport(
        "apply",
        { batch: bundle.batch.batch, backupSha256: backup.sha256 },
        outcomes,
      );
    }
    const report = await verifyCatalogSeed(
      db,
      bundle.batch,
      bundle.sha256,
      actor.id,
    );
    await verifySeedFiles(report, bundle);
    printVerification(report);
  } finally {
    await session.query("SELECT pg_advisory_unlock_all()").catch(() => {});
    session.release();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await runCatalogImport(process.argv.slice(2));
  } catch (error) {
    console.error(errorMessage(error));
    process.exitCode = 1;
  } finally {
    await db.end();
  }
}
