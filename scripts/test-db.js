// Disposable PostgreSQL engine for HTTP/UI smoke tests; never used by the app or Docker.
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { readFile } from "node:fs/promises";
const db = await PGlite.create();
await db.exec(
  await readFile(new URL("../db/001_initial.sql", import.meta.url), "utf8"),
);
const server = new PGLiteSocketServer({
  db,
  host: "127.0.0.1",
  port: 5432,
  maxConnections: 20,
});
await server.start();
console.log("Disposable test DB ready on 127.0.0.1:5432");
process.on("SIGINT", async () => {
  await server.stop();
  await db.close();
  process.exit(0);
});
