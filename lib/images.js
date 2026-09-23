import sharp from "sharp";

export async function preparePhoto(bytes, { bikePhoto = true } = {}) {
  // Check the bytes, not only the caller-provided Content-Type. Never decode SVG/AVIF.
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const webp =
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP";
  if (!jpeg && !png && !webp) throw new Error("UNSUPPORTED_IMAGE");
  const source = sharp(bytes, { limitInputPixels: 40000000, animated: false });
  const metadata = await source.metadata();
  if (
    bikePhoto &&
    (Math.min(metadata.width || 0, metadata.height || 0) < 400 ||
      Math.max(metadata.width || 0, metadata.height || 0) < 600)
  )
    throw new Error("Фото слишком маленькое: минимум 600 × 400 пикселей");
  return source
    .rotate()
    .resize({
      width: 2400,
      height: 2400,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 88 })
    .toBuffer();
}

// Bounded presentation sizes; the route checks ownership/public visibility first.
// Matches mediaWidths in media-cache.js (kept separate to avoid an import cycle).
export async function prepareThumbnail(bytes, width) {
  if (![160, 320, 640, 1280].includes(width))
    throw new Error("INVALID_THUMBNAIL_SIZE");
  return sharp(bytes)
    .rotate()
    .resize({ width, height: width, fit: "inside", withoutEnlargement: true })
    .webp({ quality: width <= 320 ? 78 : 82 })
    .toBuffer();
}
