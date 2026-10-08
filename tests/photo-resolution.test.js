import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { isTooSmall, preparePhoto } from "../lib/images.ts";
test("bike images require 600 by 400; icons and avatars retain their own sizing", async () => {
  const small = await sharp({
    create: { width: 100, height: 100, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  await assert.rejects(preparePhoto(small), /600/);
  await preparePhoto(small, { bikePhoto: false });
  const portrait = await sharp({
    create: { width: 400, height: 600, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  const result = await preparePhoto(portrait);
  assert.equal((await sharp(result).metadata()).format, "webp");
});

test("the size rule can be asked on its own, by the measure of the picture as it came", async () => {
  const flat = (width, height) =>
    sharp({ create: { width, height, channels: 3, background: "white" } })
      .png()
      .toBuffer();
  assert.equal(await isTooSmall(await flat(100, 100)), true);
  assert.equal(await isTooSmall(await flat(599, 400)), true);
  assert.equal(await isTooSmall(await flat(600, 399)), true);
  assert.equal(await isTooSmall(await flat(600, 400)), false);
  assert.equal(await isTooSmall(await flat(400, 600)), false);
  // A long strip passes as it comes (its long side is cut to 2400 afterwards).
  assert.equal(await isTooSmall(await flat(3000, 400)), false);
  // What cannot be read is not «too small»: the reading says what is wrong.
  assert.equal(await isTooSmall(Buffer.from("not an image")), false);
});
