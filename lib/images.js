import sharp from "sharp";

export async function preparePhoto(bytes) {
  // Check the bytes, not only the caller-provided Content-Type. Never decode SVG/AVIF.
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const webp =
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP";
  if (!jpeg && !png && !webp) throw new Error("UNSUPPORTED_IMAGE");
  return sharp(bytes, { limitInputPixels: 40000000, animated: false })
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
