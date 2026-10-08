import sharp from "sharp";
import { siteGraphicWidths } from "./media-sizes.ts";

// Check the bytes, not only the caller-provided Content-Type. Never decode SVG/AVIF.
export function sniffImage(bytes: Buffer) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "jpeg";
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "png";
  if (
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    return "webp";
  return null;
}

export async function preparePhoto(bytes: Buffer, { bikePhoto = true } = {}) {
  if (!sniffImage(bytes)) throw new Error("UNSUPPORTED_IMAGE");
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
export async function prepareThumbnail(bytes: Buffer, width: number) {
  if (!siteGraphicWidths.includes(width))
    throw new Error("INVALID_THUMBNAIL_SIZE");
  return sharp(bytes)
    .rotate()
    .resize({ width, height: width, fit: "inside", withoutEnlargement: true })
    .webp({ quality: width <= 320 ? 78 : width > 1280 ? 88 : 82 })
    .toBuffer();
}

// The longest side of a stored photo; what a cut-out is made from and into.
const photoEdge = 2400;
/**
 * The picture as straight RGBA pixels, upright and no larger than a stored
 * photo, for work on the pixels themselves (the removal of a backdrop, #370).
 * Transparency of the source is kept.
 */
export async function decodeRaw(bytes: Buffer) {
  if (!sniffImage(bytes)) throw new Error("UNSUPPORTED_IMAGE");
  const { data, info } = await sharp(bytes, {
    limitInputPixels: 40000000,
    animated: false,
  })
    .rotate()
    .resize({
      width: photoEdge,
      height: photoEdge,
      fit: "inside",
      withoutEnlargement: true,
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    width: info.width,
    height: info.height,
  };
}

/**
 * WebP with transparency, as stored photos are: the alpha is lossless, so the
 * edge of the object is exactly what the removal drew, and no backdrop is
 * painted in.
 */
export function encodeWithAlpha(image: {
  data: Uint8Array;
  width: number;
  height: number;
}) {
  const { buffer, byteOffset, byteLength } = image.data;
  return sharp(Buffer.from(buffer, byteOffset, byteLength), {
    raw: { width: image.width, height: image.height, channels: 4 },
  })
    .webp({ quality: 90, alphaQuality: 100 })
    .toBuffer();
}
