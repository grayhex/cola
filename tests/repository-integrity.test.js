import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile, readdir, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
async function files(dir) {
  const result = [];
  for (const entry of await readdir(path.join(root, dir), { withFileTypes: true })) {
    const name = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await files(name));
    else if (entry.isFile()) result.push(name);
  }
  return result;
}
async function exists(file) {
  try { await access(file); return true; }
  catch (error) {
    // A candidate such as icons.jsx/index.js has a file as its parent.
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
    throw error;
  }
}
function importCandidates(file, specifier) {
  const relative = path.normalize(path.join(path.dirname(file), specifier.split(/[?#]/)[0]));
  const extensions = [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"];
  const candidates = [
    relative,
    ...extensions.map((extension) => relative + extension),
    ...extensions.map((extension) => path.join(relative, "index" + extension)),
  ];
  // TypeScript commonly spells source imports with the emitted .js extension.
  if (relative.endsWith(".js"))
    candidates.push(relative.slice(0, -3) + ".ts", relative.slice(0, -3) + ".tsx");
  return [...new Set(candidates)];
}

test("repository path probes reject invalid candidates without masking filesystem errors", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "cola-import-probes-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "icons.jsx");
  await writeFile(file, "export default {};\n");
  // Probe the same candidates as the import scan, including file/index.*.
  // A valid file must not be rejected because another candidate yields ENOTDIR.
  const jsCandidates = importCandidates(path.join(dir, "view.jsx"), "./icons.jsx");
  assert.equal((await Promise.all(jsCandidates.map(exists))).some(Boolean), true);
  await mkdir(path.join(dir, "component"));
  await writeFile(path.join(dir, "component/index.js"), "export default {};\n");
  assert.equal((await Promise.all(
    importCandidates(path.join(dir, "view.jsx"), "./component").map(exists),
  )).some(Boolean), true);
  // JSDoc imports in application JS legitimately point at Resolver TypeScript sources.
  await writeFile(path.join(dir, "domain.ts"), "export type BikeQuery = {};\n");
  assert.equal((await Promise.all(
    importCandidates(path.join(dir, "client.js"), "./domain").map(exists),
  )).some(Boolean), true);
  assert.equal((await Promise.all(
    importCandidates(path.join(dir, "view.jsx"), "./missing").map(exists),
  )).some(Boolean), false, "Missing imports must still fail resolution");
  // Only path-absence errors may be converted to false, not arbitrary failures.
  await assert.rejects(exists("\0"), { code: "ERR_INVALID_ARG_VALUE" });
});

test("handbook manifest and relative document/image links resolve in this tree", async () => {
  const book = JSON.parse(await readFile(path.join(root, "docs/book.json"), "utf8"));
  assert.equal(book.pathBase, "docs");
  assert.equal(Object.hasOwn(book, "compatibilityPaths"), false);
  assert.equal(new Set(book.chapters).size, book.chapters.length);
  for (const chapter of book.chapters)
    assert.ok(await exists(path.join(root, "docs", chapter)), `Missing chapter: ${chapter}`);
  assert.deepEqual((await readdir(path.join(root, "docs"))).filter((p) => p.endsWith(".md")), ["README.md"]);
  for (const dir of ["workbench", "docs/screenshots"])
    assert.equal(await exists(path.join(root, dir)), false, `Historical artifacts: ${dir}`);
  const documents = ["README.md", "CONTRIBUTING.md", "services/bike-resolver/README.md",
    ...(await files("docs")).filter((p) => p.endsWith(".md"))];
  for (const file of documents) {
    // Examples in fenced code are not rendered document links.
    const source = (await readFile(path.join(root, file), "utf8")).replace(/```[\s\S]*?```/g, "");
    for (const match of source.matchAll(/!?\[[^\n]*?\]\(([^)\n]+)\)/g)) {
      const target = match[1].trim().match(/^(?:<([^>]+)>|(\S+))/);
      const href = target?.[1] || target?.[2] || "";
      if (!href || /^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(href)) continue;
      const relative = decodeURIComponent(href.split(/[?#]/)[0]);
      assert.ok(await exists(path.resolve(root, path.dirname(file), relative)), `${file}: missing ${href}`);
    }
  }
});

test("migration registry covers the schema without reusing the retired number", async () => {
  const source = await readFile(path.join(root, "scripts/migrate.js"), "utf8");
  const versions = [...source.matchAll(/"(\d{3}_[a-z0-9_]+)"/g)].map((m) => m[1]);
  const schema = (await readdir(path.join(root, "db"))).filter((p) => p.endsWith(".sql"));
  assert.equal(new Set(versions).size, versions.length);
  assert.ok(versions.length > 0);
  assert.ok(versions.every((v) => !v.startsWith("013_")));
  assert.deepEqual(schema.sort(), versions.map((v) => v + ".sql").sort());
  const testDb = await readFile(path.join(root, "scripts/test-db.js"), "utf8");
  for (const version of versions) assert.ok(testDb.includes(`../db/${version}.sql`), `Test DB omits ${version}`);
});

test("literal relative imports in application, operator and Resolver sources resolve", async () => {
  const generated = new Map([
    ["lib/version.js", "scripts/build-version.js"],
    ["services/bike-resolver/src/version.ts", "services/bike-resolver/scripts/build-version.js"],
  ]);
  for (const dir of ["app", "lib", "scripts", "services/bike-resolver/src", "services/bike-resolver/scripts"]) {
    for (const file of (await files(dir)).filter((p) => /\.(?:js|jsx|mjs|ts|tsx)$/.test(p))) {
      const source = await readFile(path.join(root, file), "utf8");
      for (const match of source.matchAll(/\b(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s*)["'](\.{1,2}\/[^"']+)["']/g)) {
        const candidates = importCandidates(file, match[1]);
        if (candidates.some((p) => generated.has(p))) {
          for (const p of candidates.filter((p) => generated.has(p)))
            assert.ok(await exists(path.join(root, generated.get(p))), `Missing generator for ${p}`);
          continue;
        }
        assert.ok((await Promise.all(candidates.map((p) => exists(path.join(root, p))))).some(Boolean), `${file}: missing import ${match[1]}`);
      }
    }
  }
});
