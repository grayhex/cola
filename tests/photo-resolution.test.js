import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { preparePhoto } from "../lib/images.js";
test("bike images require 600 by 400; icons and avatars retain their own sizing", async () => {
  const small = await sharp({ create: { width: 100, height: 100, channels: 3, background: "white" } }).png().toBuffer();
  await assert.rejects(preparePhoto(small), /600/);
  await preparePhoto(small, { bikePhoto: false });
  const portrait = await sharp({ create: { width: 400, height: 600, channels: 3, background: "white" } }).png().toBuffer();
  const result = await preparePhoto(portrait);
  assert.equal((await sharp(result).metadata()).format, "webp");
});
