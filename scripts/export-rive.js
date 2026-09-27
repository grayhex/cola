// Deterministic, offline colour-only exports from the two approved CC BY assets.
// Offsets identify serialized colour properties, not arbitrary byte matches.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createCanvas, Path2D, DOMMatrix, ImageData } from "@napi-rs/canvas";
import Rive from "@rive-app/canvas-advanced-lite";

const require = createRequire(import.meta.url);
// Canvas2D rendering in Node; Rive's optional image-mesh WebGL probe returns null.
Object.assign(globalThis, {
  Path2D,
  DOMMatrix,
  ImageData,
  document: { createElement: () => ({ getContext: () => null }) },
});
const runtime = await Rive({
  wasmBinary: await readFile(
    require.resolve("@rive-app/canvas-advanced-lite/rive.wasm"),
  ),
});
const manifest = JSON.parse(
  await readFile("assets/rive/manifest.json", "utf8"),
);
for (const asset of manifest) {
  const original = await readFile(`assets/rive/${asset.name}.source.riv`);
  if (createHash("sha256").update(original).digest("hex") !== asset.sha256)
    throw new Error(
      `Source changed: ${asset.name}. Review the colour manifest.`,
    );
  for (const [index, theme] of ["light", "dark"].entries()) {
    const bytes = Buffer.from(original);
    for (const { offset, value, type, property } of asset.colors) {
      if (
        ![
          [18, 37],
          [19, 38],
          [37, 88],
        ].some(([t, p]) => type === t && property === p) ||
        bytes.readUInt32LE(offset).toString(16).padStart(8, "0") !== value
      )
        throw new Error(`Invalid colour property: ${asset.name}:${offset}`);
      const replacement = asset.palette[value.slice(2)]?.[index];
      if (replacement)
        bytes.writeUInt32LE(
          parseInt(
            replacement.length === 8
              ? replacement
              : value.slice(0, 2) + replacement,
            16,
          ),
          offset,
        );
    }
    const prefix = `public/rive/${asset.name}-${theme}`;
    await writeFile(prefix + ".riv", bytes);
    const file = await runtime.load(new Uint8Array(bytes));
    if (!file) throw new Error(`Cannot load ${prefix}`);
    const artboard = file.artboardByName(asset.artboard);
    const canvas = createCanvas(asset.width, asset.height);
    const renderer = runtime.makeRenderer(canvas);
    const animations = asset.animations.map((name) => {
      const instance = new runtime.LinearAnimationInstance(
        artboard.animationByName(name),
        artboard,
      );
      instance.advance(0);
      instance.apply(1);
      return instance;
    });
    artboard.advance(0);
    renderer.beginFrame();
    renderer.save();
    renderer.align(
      runtime.Fit.contain,
      runtime.Alignment.center,
      { minX: 0, minY: 0, maxX: asset.width, maxY: asset.height },
      artboard.bounds,
    );
    artboard.draw(renderer);
    renderer.restore();
    runtime.resolveAnimationFrame();
    await writeFile(prefix + ".png", canvas.toBuffer("image/png"));
    for (const animation of animations) animation.delete();
    renderer.delete();
    artboard.delete();
    file.delete();
  }
}
