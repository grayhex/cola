import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { prepareIcon } from "../lib/icon-pack-images.js";
import { iconPackNames } from "../lib/icon-pack.js";
import { settingsInput } from "../lib/admin-validation.js";
import { defaultSettings } from "../lib/site-defaults.js";

const png = (width = 64, height = 64) => sharp({ create: { width, height, channels: 4, background: { r: 37, g: 42, b: 46, alpha: 0.5 } } }).png().toBuffer();
test("PNG icons retain dimensions, alpha and visible pixel colours losslessly", async () => {
  const source = await png();
  const result = await prepareIcon(source);
  const metadata = await sharp(result.bytes).metadata();
  assert.equal(metadata.format, "webp"); assert.equal(metadata.width, 64);
  assert.equal(metadata.height, 64); assert.equal(metadata.hasAlpha, true);
  assert.deepEqual(await sharp(result.bytes).raw().toBuffer(), await sharp(source).raw().toBuffer());
  assert.ok(result.preview.startsWith("data:image/webp;base64,"));
});
test("preview is bounded to 64px but the original pixel master is not resized", async () => {
  const result = await prepareIcon(await png(256, 256));
  assert.equal((await sharp(result.bytes).metadata()).width, 256);
  const preview = Buffer.from(result.preview.split(",")[1], "base64");
  assert.equal((await sharp(preview).metadata()).width, 64);
});
test("reject vector/HTML/JPEG, oversized, corrupt and non-square icons", async () => {
  for (const source of [Buffer.from("<svg><script/></svg>"), Buffer.from("<html/>"), Buffer.alloc(2 * 1024 * 1024 + 1), await png(64, 40), await png(8, 8), await png(513, 513), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])])
    await assert.rejects(prepareIcon(source));
  await assert.rejects(prepareIcon(await sharp(await png()).jpeg().toBuffer()));
});
test("versioned settings schema accepts all canonical slots and rejects unknown keys", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const uiIcons = Object.fromEntries(iconPackNames.map((name) => [name, id]));
  assert.ok(settingsInput.safeParse({ ...defaultSettings, uiIcons }).success);
  assert.ok(settingsInput.safeParse({ ...defaultSettings, uiIcons: { saved: null, saved_active: id, Home: id } }).success);
  assert.equal(settingsInput.safeParse({ ...defaultSettings, uiIcons: { unrecognised: id } }).success, false);
});
