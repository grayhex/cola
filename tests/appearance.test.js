import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { contrastRatio, titleHover } from "../lib/appearance.js";

// The hover surface of each theme, read from the tokens so a new surface
// colour cannot silently break the guarantee.
async function hoverSurfaces() {
  const tokens = await readFile(
    new URL("../app/styles/tokens.css", import.meta.url),
    "utf8",
  );
  const gray = (name) =>
    tokens.match(new RegExp(`--${name}:\\s*(#[\\da-f]{6})`, "i"))?.[1];
  const [light, dark] = [
    ...tokens.matchAll(/--surface-hover:\s*var\(--(gray-\d+)\)/g),
  ].map((m) => gray(m[1]));
  assert.ok(light && dark, "tokens.css names both hover surfaces");
  return { light, dark };
}

test("card title hover keeps 4.5:1 on the hover surface for any accent (#264)", async () => {
  const surfaces = await hoverSurfaces();
  const steps = [0, 0x33, 0x66, 0x99, 0xcc, 0xff];
  const accents = ["#000000", "#FFFFFF", "#F3B51B", "#1D4ED8", "#808080"];
  for (const r of steps)
    for (const g of steps)
      for (const b of steps)
        accents.push(
          "#" + [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join(""),
        );
  for (const accent of accents)
    for (const theme of /** @type {const} */ (["light", "dark"])) {
      const color = titleHover(accent, theme);
      assert.match(color, /^#[\dA-F]{6}$/);
      assert.ok(
        contrastRatio(color, surfaces[theme]) >= 4.5,
        `${accent} on ${theme}: ${color}`,
      );
    }
});

test("card title hover keeps the reviewed mix when it is already readable", () => {
  // 55 % of the default yellow on black: tokens.css --accent-text.
  assert.equal(titleHover("#F3B51B", "light"), "#86640F");
  // Deep accents lighten on the dark theme instead of sinking into it.
  assert.ok(contrastRatio(titleHover("#000000", "dark"), "#111827") >= 4.5);
  assert.notEqual(titleHover("#000000", "dark"), "#FFFFFF");
  // A white accent darkens enough on the light theme.
  assert.ok(contrastRatio(titleHover("#FFFFFF", "light"), "#F3F4F6") >= 4.5);
  // Garbage never reaches the page's CSS.
  assert.equal(titleHover("red;}", "light"), "#000000");
  assert.equal(titleHover("", "dark"), "#FFFFFF");
});
