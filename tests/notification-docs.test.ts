import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildOpenApiDocument } from "../lib/api-v1/openapi.ts";
import {
  notificationCategories,
  notificationCategoryKeys,
  notificationEvents,
  notificationTypes,
  plannedNotificationCategories,
} from "../lib/notification-catalog.ts";
import { fixtureDirectory } from "./support/notification-fixtures.ts";

// The chapter docs/modules/notifications.md is the table people read, and the
// catalogue is the one the server runs on (#341). They must say the same: an
// event added to the code without a row in the matrix, or a category the
// chapter does not know, fails here.

const chapter = await readFile(
  fileURLToPath(new URL("../docs/modules/notifications.md", import.meta.url)),
  "utf8",
);

/** The text of one `## ` section, up to the next heading of the same or a higher level. */
function section(heading: string) {
  const lines = chapter.split("\n");
  const start = lines.findIndex((line) => line === heading);
  assert.ok(start >= 0, `no section ${heading}`);
  const level = heading.match(/^#+/)![0].length;
  const end = lines.findIndex(
    (line, index) =>
      index > start &&
      /^#+ /.test(line) &&
      line.match(/^#+/)![0].length <= level,
  );
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n");
}

/** The rows of the first table of a text, as cells without padding or the header. */
function rows(text: string) {
  const lines = text.split("\n");
  const first = lines.findIndex((line) => line.startsWith("|"));
  assert.ok(first >= 0, "no table");
  const block: string[] = [];
  for (const line of lines.slice(first)) {
    if (!line.startsWith("|")) break;
    block.push(line);
  }
  return block
    .filter((line) => !/^\|[\s:|-]+\|$/.test(line))
    .map((line) =>
      line
        .slice(1, line.lastIndexOf("|"))
        .split("|")
        .map((cell) => cell.trim()),
    )
    .slice(1);
}
const key = (cell: string) => cell.match(/^`([a-z_-]+)`/)?.[1] ?? "";

test("the matrix lists every event of the catalogue once, in its category", () => {
  const matrix = rows(section("## Матрица событий"));
  const listed = matrix.map(([type]) => key(type));
  assert.deepEqual(
    [...listed].sort(),
    [...notificationTypes].sort(),
    "each event type, and nothing else, has a row",
  );
  for (const [type, category] of matrix.map((row) => [
    key(row[0]),
    key(row[1]),
  ]))
    assert.equal(
      category,
      notificationEvents[type as keyof typeof notificationEvents].category,
      type,
    );
  // The columns the chapter promises are all there for every row.
  for (const row of matrix) {
    assert.equal(row.length, 7, row[0]);
    for (const cell of row) assert.notEqual(cell, "", row[0]);
  }
});

test("the table of categories lists every category with the channels it can use", () => {
  const table = rows(section("## Категории и каналы"));
  assert.deepEqual(
    table.map(([name]) => key(name)),
    [...notificationCategoryKeys],
  );
  const word = (flag: boolean) => (flag ? "да" : "нет");
  for (const [name, , email, push] of table) {
    const category =
      notificationCategories[key(name) as keyof typeof notificationCategories];
    assert.equal(email, word(category.email), `${key(name)}: письмо`);
    assert.equal(push, word(category.push), `${key(name)}: push`);
  }
  // The categories nothing produces yet are named, so a client may know them.
  const planned = section("## Категории и каналы");
  for (const category of Object.keys(plannedNotificationCategories))
    assert.ok(planned.includes(`\`${category}\``), category);
});

test("the events nothing creates yet are the planned categories, and none is in the matrix", () => {
  const table = rows(section("### Ещё не созданные события"));
  const named = table.map(([, category]) => key(category)).sort();
  assert.deepEqual(named, Object.keys(plannedNotificationCategories).sort());
  const matrix = section("## Матрица событий").split("### ")[0];
  for (const category of Object.keys(plannedNotificationCategories))
    assert.equal(
      rows(matrix).some((row) => key(row[1]) === category),
      false,
      category,
    );
});

test("the published fixtures and the endpoints the chapter names exist", async () => {
  for (const file of ["targets", "payload", "preferences", "read"]) {
    assert.ok(chapter.includes(`\`${file}.json\``), file);
    await access(`${fixtureDirectory}${file}.json`);
  }
  const { paths } = buildOpenApiDocument("https://example.test") as {
    paths: Record<string, Record<string, unknown>>;
  };
  const named: Array<[string, string]> = [
    ["/me/notifications/{id}/read", "put"],
    ["/me/notifications/read", "post"],
    ["/me/notifications/read-all", "post"],
    ["/me/notification-settings", "get"],
    ["/me/notification-settings", "patch"],
    ["/me/notifications/count", "get"],
    ["/me/notifications", "get"],
  ];
  for (const [route, method] of named) {
    assert.ok(paths[route]?.[method], `${method} ${route} is in the contract`);
    const written = `${method.toUpperCase()} /api/v1${route}`;
    // `GET /me/notifications` and `…/count` are written in a short form.
    assert.ok(
      chapter.includes(written) ||
        chapter.includes(`${method.toUpperCase()} /me${route.slice(3)}`) ||
        chapter.includes(`/me${route.slice(3)}`),
      `the chapter names ${written}`,
    );
  }
});

test("what the chapter says is not there yet is not claimed as done", () => {
  const missing = section("## Чего ещё нет");
  for (const word of ["N1.3", "#342", "#343"])
    assert.ok(missing.includes(word), word);
  // The scope line counts what is done and what is next, so a reader cannot
  // take a planned switch for a working one.
  const scope = section("## Назначение и границы");
  assert.match(scope, /\*\*Сделано \(N1\.1\)/);
  assert.match(scope, /\*\*Сделано \(N1\.2\)/);
  assert.match(scope, /\*\*Затем \(N1\.3\)/);
});
