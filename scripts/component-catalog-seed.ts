import { createHash } from "node:crypto";
import { readFile, lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";
import { validateCatalogSeed } from "../lib/component-catalog-seed.ts";
import { errorMessage } from "../lib/errors.ts";

export const hash = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");
export const defaultSeedDirectory = fileURLToPath(
  new URL("../data/component-catalog/v1/", import.meta.url),
);

// Read-only, including media verification. No mkdir, downloaded content or DB.
export async function loadCatalogSeedBundle(
  directory: string,
  expectedHash?: string,
) {
  const root = await realpath(directory);
  const [catalogBytes, scopeBytes] = await Promise.all(
    ["catalog.json", "scope.json"].map((name) =>
      readFile(path.join(root, name)),
    ),
  );
  const sha256 = hash(
    JSON.stringify({ catalog: hash(catalogBytes), scope: hash(scopeBytes) }),
  );
  if (expectedHash && sha256 !== expectedHash)
    throw new Error("Package SHA-256 does not match the approved release");
  const validated = validateCatalogSeed(
    JSON.parse(catalogBytes.toString("utf8")),
    JSON.parse(scopeBytes.toString("utf8")),
  );
  const errors: string[] = [];
  for (const entry of validated.batch.entries) {
    if (entry.status !== "approved" || entry.photo.status !== "ready") continue;
    const photo = entry.photo;
    try {
      const file = path.join(root, photo.file);
      const info = await lstat(file);
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        info.size !== photo.bytes ||
        !(await realpath(file)).startsWith(root + path.sep)
      )
        throw new Error("not a regular local file of the declared size");
      const bytes = await readFile(file);
      if (hash(bytes) !== photo.sha256) throw new Error("SHA-256 mismatch");
      const metadata = await sharp(bytes, {
        limitInputPixels: 40_000_000,
      }).metadata();
      if (
        metadata.format !== "webp" ||
        metadata.width !== photo.width ||
        metadata.height !== photo.height ||
        metadata.orientation ||
        metadata.exif ||
        metadata.icc ||
        metadata.iptc ||
        metadata.xmp ||
        (metadata.pages && metadata.pages !== 1)
      )
        throw new Error("media is not the declared normalized still WebP");
    } catch (error) {
      errors.push(`${entry.seedKey}: ${photo.file}: ${errorMessage(error)}`);
    }
  }
  if (errors.length)
    throw new Error("Media validation failed:\n" + errors.join("\n"));
  return { ...validated, root, sha256 };
}

async function main(args: string[]) {
  const [mode, directory = defaultSeedDirectory, expectedHash] = args;
  if (mode !== "validate" || args.length > 3)
    throw new Error(
      "Usage: node scripts/component-catalog-seed.ts validate [directory] [approved SHA-256]",
    );
  const bundle = await loadCatalogSeedBundle(directory, expectedHash);
  console.log(
    JSON.stringify(
      { batch: bundle.batch.batch, sha256: bundle.sha256, ...bundle.counts },
      null,
      2,
    ),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main(process.argv.slice(2)).catch((error) => {
    console.error(errorMessage(error));
    process.exitCode = 1;
  });
