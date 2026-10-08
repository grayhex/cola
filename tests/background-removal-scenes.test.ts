import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { removeBackground } from "../lib/background-removal.ts";
import { decodeRaw } from "../lib/images.ts";

// #370: the removal on pictures that went the way of a real upload — drawn as a
// bike (two spoked wheels, a frame, a cable, a floor shadow), compressed to
// JPEG, read back by the site's own decoder — not on exact pixels.
const width = 1200,
  height = 760;
const spokes = (cx: number, cy: number, radius: number, count: number) =>
  Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2;
    return `<line x1="${cx}" y1="${cy}" x2="${cx + Math.cos(a) * (radius - 8)}" y2="${cy + Math.sin(a) * (radius - 8)}" stroke="#9a9a9a" stroke-width="1.4"/>`;
  }).join("");
const wheel = (cx: number, cy: number) =>
  `<circle cx="${cx}" cy="${cy}" r="160" fill="none" stroke="#1d1d1f" stroke-width="18"/><circle cx="${cx}" cy="${cy}" r="146" fill="none" stroke="#bdbdbd" stroke-width="3"/>${spokes(cx, cy, 150, 28)}<circle cx="${cx}" cy="${cy}" r="11" fill="#555"/>`;
const bike = (frame: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${wheel(350, 520)}${wheel(850, 520)}
  <g stroke="${frame}" stroke-width="16" stroke-linecap="round" fill="none"><path d="M350 520 L520 310 L760 310 L850 520"/><path d="M520 310 L570 520 L350 520"/><path d="M570 520 L760 310"/><path d="M760 310 L790 240"/><path d="M790 240 L870 240" stroke-width="12"/></g>
  <path d="M790 240 C840 310 865 420 855 510" stroke="#333" stroke-width="2.5" fill="none"/></svg>`;
async function photo(frame: string, background: string) {
  const shadow = await sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><ellipse cx="600" cy="705" rx="470" ry="26" fill="#000" fill-opacity="0.55"/></svg>`,
    ),
  )
    .blur(18)
    .png()
    .toBuffer();
  const jpeg = await sharp({
    create: { width, height, channels: 3, background },
  })
    .composite([{ input: shadow }, { input: Buffer.from(bike(frame)) }])
    .jpeg({ quality: 78 })
    .toBuffer();
  return removeBackground(await decodeRaw(jpeg));
}
type Cleared = Awaited<ReturnType<typeof photo>>;
const alpha = (r: Cleared, x: number, y: number) =>
  r.data[(y * r.width + x) * 4 + 3];
const around = (r: Cleared, x: number, y: number, radius: number) => {
  let best = 0;
  for (let dy = -radius; dy <= radius; dy++)
    for (let dx = -radius; dx <= radius; dx++)
      best = Math.max(best, alpha(r, x + dx, y + dy));
  return best;
};

test("a coloured frame on cream: frame, wheels, spokes and cable stay; the backdrop is clear; the floor shadow is see-through", async () => {
  const result = await photo("#27496d", "#eeeae0");
  // The cream of the backdrop, as JPEG gives it back.
  for (const [i, truth] of [238, 234, 224].entries())
    assert.ok(
      Math.abs(result.background[i] - truth) <= 6,
      `${result.background}`,
    );
  assert.equal(alpha(result, 6, 6), 0);
  assert.equal(alpha(result, width - 8, 8), 0);
  assert.equal(around(result, 640, 310, 1), 255, "the top tube");
  assert.equal(around(result, 546, 420, 3), 255, "the seat tube");
  assert.equal(around(result, 350, 520 - 160, 2), 255, "the tyre");
  // Between the spokes the wheel is open; on a spoke it is not.
  assert.equal(alpha(result, 297, 605), 0, "between two spokes");
  let spokesKept = 0,
    spokeSamples = 0;
  for (let r = 40; r < 140; r += 5) {
    spokeSamples++;
    if (around(result, 850 + r, 520, 1) > 100) spokesKept++;
  }
  assert.ok(spokesKept >= spokeSamples - 1, "a spoke is kept along its length");
  // The cable: a curve a couple of pixels wide, found by its own equation.
  let cable = 0;
  const samples = 30;
  for (let k = 0; k < samples; k++) {
    const t = 0.1 + (0.85 * k) / (samples - 1),
      u = 1 - t;
    const x =
        u ** 3 * 790 + 3 * u * u * t * 840 + 3 * u * t * t * 865 + t ** 3 * 855,
      y =
        u ** 3 * 240 + 3 * u * u * t * 310 + 3 * u * t * t * 420 + t ** 3 * 510;
    if (around(result, Math.round(x), Math.round(y), 2) > 120) cable++;
  }
  assert.ok(
    cable >= samples - 3,
    `${cable} of ${samples} samples of the cable are kept`,
  );
  // The shadow under the wheels: some opacity, never solid.
  let strongest = 0;
  for (let x = 250; x < 950; x += 10)
    strongest = Math.max(strongest, alpha(result, x, 706));
  assert.ok(strongest > 25 && strongest < 235, `the shadow is ${strongest}`);
});

test("a dark frame on white, and a pale grey frame on white, are both kept", async () => {
  const dark = await photo("#14181c", "#ffffff");
  assert.equal(around(dark, 640, 310, 1), 255);
  assert.equal(alpha(dark, 8, 8), 0);
  // About nine per cent darker than the backdrop: far above the noise.
  const pale = await photo("#e8e8e8", "#ffffff");
  assert.equal(around(pale, 640, 310, 1), 255, "the pale top tube");
  assert.equal(around(pale, 546, 420, 3), 255, "the pale seat tube");
  assert.equal(alpha(pale, 8, 8), 0);
});
