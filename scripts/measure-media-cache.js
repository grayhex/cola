// Synthetic local Sharp burst; never reads production media.
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import * as current from "../lib/media-cache.ts";
const baseline = process.argv
  .find((v) => v.startsWith("--baseline-ref="))
  ?.split("=")[1];
const root = await mkdtemp(path.join(tmpdir(), "cola-media-measure-"));
try {
  const variants = [["head", current]];
  if (baseline) {
    const sha = execFileSync(
      "git",
      ["rev-parse", "--verify", baseline + "^{commit}"],
      { encoding: "utf8" },
    ).trim();
    const source = path.join(root, "source");
    execFileSync("mkdir", [source]);
    execFileSync("tar", ["-x", "-C", source], {
      input: execFileSync(
        "git",
        ["archive", sha, "lib", "services/bike-resolver/src"],
        { maxBuffer: 32 * 1024 * 1024 },
      ),
    });
    await symlink(
      path.resolve("node_modules"),
      path.join(source, "node_modules"),
    );
    variants.unshift([
      sha,
      await import(pathToFileURL(path.join(source, "lib/media-cache.ts"))),
    ]);
  }
  const original = await sharp({
    create: { width: 2400, height: 1600, channels: 3, background: "#abc" },
  })
    .png()
    .toBuffer();
  for (const [revision, cache] of variants) {
    const env = { MEDIA_CACHE_DIR: path.join(root, revision) };
    for (const mode of ["same-cold", "same-warm", "different-cold"]) {
      let builds = 0,
        running = 0,
        maximum = 0;
      const cpu = process.cpuUsage(),
        start = performance.now(),
        rssBefore = process.memoryUsage().rss;
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          cache.cachedDerivative(
            mode === "different-cold" ? `different-${i}.webp` : "same.webp",
            async () => {
              builds++;
              running++;
              maximum = Math.max(maximum, running);
              try {
                return await sharp(original)
                  .resize(640)
                  .webp({ quality: 82 })
                  .toBuffer();
              } finally {
                running--;
              }
            },
            env,
          ),
        ),
      );
      const spent = process.cpuUsage(cpu);
      console.log(
        JSON.stringify({
          revision,
          mode,
          requests: 20,
          builds,
          maximum,
          elapsedMs: Math.round(performance.now() - start),
          cpuMs: Math.round((spent.user + spent.system) / 1000),
          rssBefore,
          rssAfter: process.memoryUsage().rss,
          bytes: results[0].length,
        }),
      );
    }
  }
} finally {
  await rm(root, { recursive: true, force: true });
}
