import { test } from "node:test";
import assert from "node:assert/strict";
import { plainExcerpt, joinBlocks } from "../lib/excerpt.js";
import { richExcerpt } from "../lib/rich-text.js";
import { activityExcerpt } from "../lib/discovery.js";
import { journalDto } from "../lib/journal.js";

// Intl uses no-break spaces in ru-RU prices; compare the visible text.
const norm = (value) => value.replace(/\s/gu, " ");
const markup = /(^|\s)#{1,6}\s|\*\*|\+\+|`|\[[^\]]*\]\(|(^|\s)[-*]\s|(^|\s)\d+\.\s|>\s/;

test("plain excerpts collapse whitespace and stop at a word boundary", () => {
  assert.equal(plainExcerpt("  Лёгкий\n\n темп,\t2 часа.  "), "Лёгкий темп, 2 часа.");
  assert.equal(plainExcerpt(null), "");
  const long = "Покрышки Maxxis Assegai отлично держат на корнях и камнях";
  const cut = plainExcerpt(long, 30);
  assert.ok(cut.length <= 31, cut);
  assert.ok(cut.endsWith("…"));
  assert.ok(long.startsWith(cut.slice(0, -1)), "cut must end on a whole word");
  assert.equal(joinBlocks("Итоги\nТекст без точки\nФинал."), "Итоги. Текст без точки. Финал.");
});

test("rich excerpts contain text without Markdown markup", () => {
  const body =
    "## Итоги\n\nЗа сезон проехала **1200 км** по трейлам. Поменяла покрышки и колодки.\n\n" +
    "- Покрышки Maxxis Assegai\n- Колодки Shimano\n\n" +
    "Подробнее в [обзоре](https://example.com/review), ++важно++ и *курсив* `код`.\n\n" +
    "> Цитата\n\n1. Первый\n2. Второй\n\n" +
    "![Фото сборки](photo:1f0e2b8a-9c1d-4e5f-8a7b-6c5d4e3f2a1b)";
  const excerpt = richExcerpt(body, 1000);
  assert.doesNotMatch(excerpt, markup, excerpt);
  assert.match(excerpt, /^Итоги\. За сезон проехала 1200 км по трейлам\./);
  assert.match(excerpt, /Покрышки Maxxis Assegai\. Колодки Shimano\./);
  assert.match(excerpt, /Подробнее в обзоре, важно и курсив код\./);
  assert.doesNotMatch(excerpt, /Фото сборки|photo:/, "image alt text is not a preview");
  assert.ok(richExcerpt(body, 60).length <= 61);
  assert.equal(richExcerpt(""), "");
});

test("journal DTO exposes a plain excerpt next to the stored body", () => {
  const dto = journalDto(
    {
      id: "entry",
      owner_id: "owner",
      title: "Сезон",
      body: "## Итоги\n\n- **Покрышки** Maxxis",
      components: [],
    },
    null,
  );
  assert.equal(dto.body, "## Итоги\n\n- **Покрышки** Maxxis");
  assert.equal(dto.excerpt, "Итоги. Покрышки Maxxis");
});
