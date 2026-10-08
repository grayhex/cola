import test from "node:test";
import assert from "node:assert/strict";
import {
  BackgroundRemovalError,
  removeBackground,
  type RawImage,
} from "../lib/background-removal.ts";

// #370: a solid background comes off, the bike stays. The pictures here are
// drawn with sub-pixel sampling so the edges are anti-aliased like a real
// photograph's: that is where a halo would show.
type Color = [number, number, number];
type Paint = (x: number, y: number) => Color | null;
function render(
  width: number,
  height: number,
  background: Color | ((x: number, y: number) => Color),
  layers: Paint[],
  noise = 0,
): RawImage {
  const data = new Uint8Array(width * height * 4);
  let seed = 7;
  const jitter = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return noise ? (seed / 2 ** 32 - 0.5) * 2 * noise : 0;
  };
  const samples = 4;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let r = 0,
        g = 0,
        b = 0;
      for (let sy = 0; sy < samples; sy++)
        for (let sx = 0; sx < samples; sx++) {
          const px = x + (sx + 0.5) / samples,
            py = y + (sy + 0.5) / samples;
          let color: Color =
            typeof background === "function" ? background(px, py) : background;
          for (const layer of layers) color = layer(px, py) || color;
          r += color[0];
          g += color[1];
          b += color[2];
        }
      const i = (y * width + x) * 4,
        n = samples * samples;
      data[i] = Math.max(0, Math.min(255, Math.round(r / n + jitter())));
      data[i + 1] = Math.max(0, Math.min(255, Math.round(g / n + jitter())));
      data[i + 2] = Math.max(0, Math.min(255, Math.round(b / n + jitter())));
      data[i + 3] = 255;
    }
  return { data, width, height };
}
const disk =
  (cx: number, cy: number, radius: number, color: Color): Paint =>
  (x, y) =>
    (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2 ? color : null;
const ring =
  (cx: number, cy: number, outer: number, inner: number, color: Color): Paint =>
  (x, y) => {
    const d = (x - cx) ** 2 + (y - cy) ** 2;
    return d <= outer ** 2 && d >= inner ** 2 ? color : null;
  };
const alphaAt = (
  image: { data: Uint8Array; width: number },
  x: number,
  y: number,
) => image.data[(y * image.width + x) * 4 + 3];
const colorAt = (
  image: { data: Uint8Array; width: number },
  x: number,
  y: number,
): Color => {
  const i = (y * image.width + x) * 4;
  return [image.data[i], image.data[i + 1], image.data[i + 2]];
};
const apart = (a: Color, b: Color) =>
  Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
const white: Color = [255, 255, 255];
const red: Color = [190, 30, 30];

test("an object on white: the background is see-through, the object opaque, the edge un-mixed (no white halo)", async () => {
  const image = render(200, 160, white, [disk(100, 80, 46, red)]);
  const result = await removeBackground(image);
  assert.deepEqual(result.background, [255, 255, 255]);
  assert.equal(alphaAt(result, 3, 3), 0);
  assert.equal(alphaAt(result, 196, 156), 0);
  assert.equal(alphaAt(result, 100, 80), 255);
  assert.deepEqual(colorAt(result, 100, 80), red);
  // Every pixel of the edge: either the object's own colour at a part of the
  // opacity, or nothing; never a whitish mix at full opacity.
  let partial = 0;
  for (let y = 30; y < 130; y++)
    for (let x = 50; x < 150; x++) {
      const a = alphaAt(result, x, y);
      if (a > 20 && a < 235) {
        partial++;
        assert.ok(
          apart(colorAt(result, x, y), red) < 45,
          `an edge pixel at ${x},${y} is ${colorAt(result, x, y)} at alpha ${a}`,
        );
      }
    }
  assert.ok(partial > 20, "the edge is anti-aliased, not cut");
  assert.ok(result.removed > 0.5 && result.removed < 0.9);
});

test("a wheel: the gap inside the ring is background too, the ring stays", async () => {
  const image = render(260, 200, white, [
    ring(130, 100, 80, 70, [40, 40, 44]),
    disk(130, 100, 6, [90, 90, 94]),
  ]);
  const result = await removeBackground(image);
  assert.equal(alphaAt(result, 130, 100 - 30), 0, "the gap inside the wheel");
  assert.equal(alphaAt(result, 130 + 40, 100), 0);
  assert.equal(alphaAt(result, 130, 100), 255, "the hub");
  assert.equal(alphaAt(result, 130, 100 - 75), 255, "the rim");
  assert.equal(alphaAt(result, 5, 5), 0);
});

test("a thin line (a spoke or a cable) across the backdrop is kept", async () => {
  const line: Paint = (x, y) =>
    Math.abs(y - (40 + x * 0.3)) <= 0.9 && x > 20 && x < 220
      ? [30, 30, 30]
      : null;
  const image = render(240, 160, white, [line, disk(120, 110, 30, red)]);
  const result = await removeBackground(image);
  let kept = 0;
  for (let x = 30; x < 90; x++) {
    const y = Math.round(40 + x * 0.3);
    let best = 0;
    for (let d = -1; d <= 1; d++)
      best = Math.max(best, alphaAt(result, x, y + d));
    if (best > 120) kept++;
  }
  assert.ok(kept > 55, `${kept} of 60 pixels of the line were kept`);
});

test("a white object with an outline on a white backdrop is not eaten", async () => {
  const frame: Color = [246, 246, 246];
  const image = render(240, 180, white, [
    disk(120, 90, 62, [60, 60, 64]),
    disk(120, 90, 58, frame),
  ]);
  const result = await removeBackground(image);
  assert.equal(
    alphaAt(result, 120, 90),
    255,
    "the white paint inside the outline",
  );
  assert.deepEqual(colorAt(result, 120, 90), frame);
  assert.equal(alphaAt(result, 120, 90 - 60), 255, "the outline");
  assert.equal(alphaAt(result, 8, 8), 0);
});

test("a soft shadow becomes see-through black, not a grey box", async () => {
  const shadow: Paint = (x, y) => {
    const d = ((x - 120) / 70) ** 2 + ((y - 150) / 12) ** 2;
    if (d >= 1) return null;
    const v = Math.round(255 - 150 * (1 - d) ** 2);
    return [v, v, v];
  };
  const image = render(240, 180, white, [shadow, disk(120, 90, 50, red)]);
  const result = await removeBackground(image);
  // Under the object: some opacity, black-ish, never solid.
  let strongest = 0,
    tinted = 0;
  for (let x = 70; x < 170; x++)
    for (let y = 142; y < 158; y++) {
      const a = alphaAt(result, x, y);
      strongest = Math.max(strongest, a);
      if (a > 25) {
        tinted++;
        assert.ok(
          apart(colorAt(result, x, y), [0, 0, 0]) < 8,
          "a shadow is black",
        );
      }
    }
  assert.ok(tinted > 80, "the shadow is kept");
  assert.ok(strongest < 235, `the shadow stays see-through (${strongest})`);
  assert.equal(alphaAt(result, 20, 150), 0, "far from the object");
  assert.equal(alphaAt(result, 120, 90), 255);
});

test("a cream backdrop with noise, and a noisy white one", async () => {
  const cream: Color = [238, 233, 220];
  const first = await removeBackground(
    render(200, 140, cream, [disk(100, 70, 40, red)], 3),
  );
  assert.equal(alphaAt(first, 4, 4), 0);
  assert.equal(alphaAt(first, 100, 70), 255);
  const second = await removeBackground(
    render(200, 140, white, [disk(100, 70, 40, red)], 5),
  );
  assert.equal(alphaAt(second, 190, 130), 0);
  assert.equal(alphaAt(second, 100, 70), 255);
});

test("what is not a plain backdrop, already see-through, or nothing, is refused with a reason", async () => {
  const gradient = render(
    200,
    140,
    (x) => {
      const v = Math.round((x / 200) * 255);
      return [v, v, v];
    },
    [disk(100, 70, 30, red)],
  );
  await assert.rejects(
    removeBackground(gradient),
    (e) => e instanceof BackgroundRemovalError && e.reason === "not_uniform",
  );

  const clear = render(100, 80, white, [disk(50, 40, 20, red)]);
  for (let i = 3; i < clear.data.length; i += 4)
    if ((i >> 2) % 100 < 30) clear.data[i] = 0;
  await assert.rejects(
    removeBackground(clear),
    (e) =>
      e instanceof BackgroundRemovalError && e.reason === "already_transparent",
  );

  const empty = render(100, 80, white, []);
  await assert.rejects(
    removeBackground(empty),
    (e) =>
      e instanceof BackgroundRemovalError &&
      ["nothing_removed", "everything_removed"].includes(e.reason),
  );

  await assert.rejects(
    removeBackground(render(50, 50, white, [disk(25, 25, 10, red)]), {
      maxPixels: 100,
    }),
    (e) => e instanceof BackgroundRemovalError && e.reason === "too_large",
  );
});

test("a deadline and a signal stop the work, and it gives the loop back meanwhile", async () => {
  const big = render(900, 700, white, [disk(450, 350, 220, red)]);
  await assert.rejects(
    removeBackground(big, { deadline: Date.now() - 1 }),
    (e) => e instanceof BackgroundRemovalError && e.reason === "timeout",
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    removeBackground(big, { signal: controller.signal }),
    (e) => e instanceof BackgroundRemovalError && e.reason === "aborted",
  );
  // The loop breathes: a timer fires while the picture is being processed.
  let ticks = 0;
  const timer = setInterval(() => ticks++, 1);
  await removeBackground(big);
  clearInterval(timer);
  assert.ok(ticks >= 1, "no slice gave the loop back");
});

test("a spoked wheel: the gaps between the spokes are background, the spokes and the rim stay", async () => {
  const cx = 150,
    cy = 120;
  const spokes: Paint = (x, y) => {
    if ((x - cx) ** 2 + (y - cy) ** 2 > 66 ** 2) return null;
    const angle = Math.atan2(y - cy, x - cx);
    const step = (Math.PI * 2) / 16;
    const off = ((angle % step) + step) % step;
    const distance = Math.hypot(x - cx, y - cy);
    const across = Math.min(off, step - off) * distance;
    return across <= 0.8 ? [70, 70, 72] : null;
  };
  const image = render(300, 240, white, [
    spokes,
    ring(cx, cy, 78, 68, [30, 30, 34]),
    disk(cx, cy, 7, [90, 90, 94]),
  ]);
  const result = await removeBackground(image);
  // Between two spokes (halfway round, mid-radius): see-through.
  const half = (Math.PI * 2) / 32;
  for (let k = 0; k < 16; k += 3) {
    const a = half + (k * Math.PI * 2) / 16;
    const x = Math.round(cx + Math.cos(a) * 45),
      y = Math.round(cy + Math.sin(a) * 45);
    assert.equal(alphaAt(result, x, y), 0, `the gap at spoke ${k}`);
  }
  // On a spoke: kept.
  let kept = 0;
  for (let r = 15; r < 60; r += 3) {
    const x = Math.round(cx + r),
      y = cy;
    let best = 0;
    for (let d = -1; d <= 1; d++)
      best = Math.max(best, alphaAt(result, x, y + d));
    if (best > 100) kept++;
  }
  assert.ok(kept >= 13, `${kept} of 15 points of a spoke were kept`);
  assert.equal(alphaAt(result, cx, cy - 73), 255, "the rim");
});

test("a pale frame, well short of white, is the object: it is not mistaken for a shadow and keeps its edge", async () => {
  const pale: Color = [224, 224, 224];
  // A tube across the picture, 9 px wide, drawn at an angle so its edge is anti-aliased.
  const tube: Paint = (x, y) => {
    const along = (x - 70) * 0.8 + (y - 190) * -0.6;
    const across = Math.abs((x - 70) * 0.6 + (y - 190) * 0.8);
    return across <= 4.5 && along >= 0 && along <= 190 ? pale : null;
  };
  const image = render(300, 240, white, [
    tube,
    ring(220, 150, 60, 52, [40, 40, 44]),
  ]);
  const result = await removeBackground(image);
  let opaque = 0,
    total = 0;
  // Up to where the ring is drawn over the tube.
  for (let t = 10; t <= 120; t += 3) {
    const x = Math.round(70 + t * 0.8),
      y = Math.round(190 + t * -0.6);
    total++;
    if (alphaAt(result, x, y) >= 250 && apart(colorAt(result, x, y), pale) < 12)
      opaque++;
  }
  assert.ok(opaque >= total - 2, `${opaque} of ${total} points are the tube`);
  assert.equal(alphaAt(result, 4, 4), 0);
  assert.equal(alphaAt(result, 220, 150 - 56), 255, "the dark ring is kept");
});

test("a shadow under a pale object is still a shadow: see-through black", async () => {
  const pale: Color = [226, 226, 226];
  const shadow: Paint = (x, y) => {
    const d = ((x - 130) / 80) ** 2 + ((y - 190) / 14) ** 2;
    if (d >= 1) return null;
    const v = Math.round(255 - 140 * (1 - d) ** 2);
    return [v, v, v];
  };
  const image = render(260, 220, white, [
    shadow,
    disk(130, 110, 50, pale),
    ring(130, 110, 62, 52, [40, 40, 44]),
  ]);
  const result = await removeBackground(image);
  let tinted = 0;
  for (let x = 80; x < 180; x++)
    for (let y = 184; y < 198; y++) {
      const a = alphaAt(result, x, y);
      if (a > 25) {
        tinted++;
        assert.ok(apart(colorAt(result, x, y), [0, 0, 0]) < 8);
        assert.ok(a < 235, "the shadow stays see-through");
      }
    }
  assert.ok(tinted > 100, "the shadow is kept");
  assert.equal(alphaAt(result, 130, 110), 255, "the pale body");
});
