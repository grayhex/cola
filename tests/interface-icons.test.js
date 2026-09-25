import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  customEmoji,
  defaultEmojis,
  emojiSlots,
  noCustomEmojis,
} from "../lib/ui-emoji.js";

test("interface icons: a line icon unless the administrator chose an emoji", () => {
  assert.equal(customEmoji(undefined, "home"), null);
  assert.equal(customEmoji({}, "home"), null);
  // Stored settings that still hold the old default emoji mean "not chosen".
  for (const { key } of emojiSlots)
    assert.equal(customEmoji(defaultEmojis, key), null, key);
  assert.equal(customEmoji({ home: "   " }, "home"), null);
  assert.equal(customEmoji({ plan: 42 }, "plan"), null);
  assert.equal(customEmoji({ plan: "🌅" }, "plan"), "🌅");
  assert.equal(customEmoji({ plan: " 🌅 " }, "plan"), "🌅");
  assert.deepEqual(
    Object.keys(noCustomEmojis).sort(),
    emojiSlots.map((s) => s.key).sort(),
  );
  assert.ok(Object.values(noCustomEmojis).every((v) => v === ""));
});

test("interface icons: every slot has its own line icon", async () => {
  const source = await readFile(
    new URL("../app/ui/site-icon.jsx", import.meta.url),
    "utf8",
  );
  const block = source.slice(
    source.indexOf("export const slotIcons"),
    source.indexOf("};", source.indexOf("export const slotIcons")),
  );
  const mapped = new Set(
    [...block.matchAll(/^\s+(\w+): [A-Z]\w*,$/gm)].map((m) => m[1]),
  );
  for (const { key } of emojiSlots) assert.ok(mapped.has(key), key);
});
