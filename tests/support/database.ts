// A disposable PostgreSQL (PGlite) with every migration applied, seen through
// the same `Queryable` the production code takes. Tests used to pass the raw
// engine to the services and copy its setup; now the type of what a service
// receives is checked, and the setup lives here once.
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Queryable, TransactionClient } from "../../lib/db.ts";
import { defaultCatalog, defaultSettings } from "../../lib/site-defaults.ts";

const migrations = new URL("../../db/", import.meta.url);

/**
 * PGlite as a `Queryable`: the engine answers with `affectedRows` where `pg`
 * says `rowCount`, and the production code is written against `pg`.
 */
export function queryable(source: Pick<PGlite, "query">): Queryable {
  return {
    async query<Row extends object>(text: string, values?: unknown[]) {
      const result = await source.query<Row>(text, values);
      return {
        rows: result.rows,
        rowCount: result.rowCount ?? result.affectedRows ?? result.rows.length,
      };
    },
  };
}

export interface TestDatabase extends Queryable {
  /** The engine, for what only it offers (`listen`, dumps). */
  readonly pglite: PGlite;
  exec(sql: string): Promise<void>;
  /**
   * One transaction; a thrown error rolls it back, as in `lib/db.ts`, whose
   * `transaction` has this very type (services take it as a parameter).
   */
  transaction<T>(fn: (client: TransactionClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** The SQL files of `db/` in the order the migrator applies them. */
export async function migrationFiles(): Promise<string[]> {
  return (await readdir(migrations))
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

/** Applies every migration to `engine`, in order. */
export async function migrate(engine: PGlite): Promise<void> {
  for (const file of await migrationFiles())
    await engine.exec(await readFile(new URL(file, migrations), "utf8"));
}

/** Applies the migrations `include` accepts, in order: the state before one. */
export async function migrateOnly(
  db: Pick<TestDatabase, "exec">,
  include: (file: string) => boolean,
): Promise<void> {
  for (const file of (await migrationFiles()).filter(include))
    await db.exec(await readFile(new URL(file, migrations), "utf8"));
}

/** A new database; `migrated: false` leaves it empty for migration tests. */
export async function testDatabase({
  migrated = true,
}: { migrated?: boolean } = {}): Promise<TestDatabase> {
  const pglite = new PGlite();
  if (migrated) await migrate(pglite);
  const own = queryable(pglite);
  return {
    pglite,
    query: own.query,
    async exec(sql) {
      await pglite.exec(sql);
    },
    // Nothing to give back: the engine holds a single connection.
    transaction: (fn) =>
      pglite.transaction((tx) => fn({ ...queryable(tx), release() {} })),
    close: () => pglite.close(),
  };
}

/** The owner's site settings and catalog as a fresh installation has them. */
export async function seedSiteDefaults(q: Queryable): Promise<void> {
  await q.query("INSERT INTO site_settings(id,value) VALUES(1,$1)", [
    JSON.stringify(defaultSettings),
  ]);
  await q.query("INSERT INTO site_catalog(id,value) VALUES(1,$1)", [
    JSON.stringify(defaultCatalog),
  ]);
}
