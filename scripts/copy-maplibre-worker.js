import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
// Next's asset pipeline does not preserve the worker's relative shared import.
// Serve the matching installed worker and shared module together, without a CDN.
const dist = path.join(
  path.dirname(
    createRequire(import.meta.url).resolve("maplibre-gl/package.json"),
  ),
  "dist",
);
const dest = new URL("../public/maplibre/", import.meta.url);
await mkdir(dest, { recursive: true });
for (const name of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  await copyFile(path.join(dist, name), new URL(name, dest));
}
