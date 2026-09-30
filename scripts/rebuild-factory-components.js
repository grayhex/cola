import { parseArgs } from "node:util";
import { db, transaction } from "../lib/db.ts";
import { rebuildFactoryComponents } from "../lib/factory-rebuild.ts";

const { values } = parseArgs({
  options: {
    apply: { type: "boolean", default: false },
    expect: { type: "string" },
  },
  strict: true,
  allowPositionals: false,
});
try {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  if (values.apply && !/^[a-f0-9]{64}$/.test(values.expect || ""))
    throw new Error(
      "--apply requires --expect <fingerprint> from the reviewed dry-run",
    );
  const report = await transaction(async (q) => {
    if (!values.apply)
      await q.query(
        "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY",
      );
    return rebuildFactoryComponents(q, {
      apply: values.apply,
      expect: values.expect,
    });
  });
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
