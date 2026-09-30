import { createRequire } from "node:module";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { riveRuntimeVersion } from "../lib/rive-assets.ts";
const require = createRequire(import.meta.url);
const entry = require.resolve("@rive-app/react-canvas-lite");
const runtimeRequire = createRequire(entry);
const { version } = JSON.parse(
  await readFile(runtimeRequire.resolve("@rive-app/canvas-lite/package.json")),
);
if (version !== riveRuntimeVersion)
  throw new Error("Update the Rive runtime version contract");
const directory = `public/rive/runtime/${version}`;
await mkdir(directory, { recursive: true });
for (const file of ["rive.wasm", "rive_fallback.wasm"])
  await copyFile(
    runtimeRequire.resolve(`@rive-app/canvas-lite/${file}`),
    `${directory}/${file}`,
  );
