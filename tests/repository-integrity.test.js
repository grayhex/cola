import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
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
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

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
        const relative = path.normalize(path.join(path.dirname(file), match[1].split(/[?#]/)[0]));
        const candidates = [relative, relative + ".js", relative + ".jsx", path.join(relative, "index.js")];
        if (/\.tsx?$/.test(file) && relative.endsWith(".js")) candidates.push(relative.slice(0, -3) + ".ts");
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
