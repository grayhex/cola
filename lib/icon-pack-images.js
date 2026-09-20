import sharp from "sharp";
import { IconPackError, ICON_FILE_LIMIT } from "./icon-pack-zip.js";

export async function prepareIcon(bytes) {
  if (!bytes.length || bytes.length > ICON_FILE_LIMIT)
    throw new IconPackError("Иконка должна быть не больше 2 МБ", 413);
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const webp = bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
  if (!png && !webp) throw new IconPackError("Поддерживаются только PNG и WebP, не SVG/JPEG");
  try {
    const metadata = await sharp(bytes, { limitInputPixels: 512 * 512, failOn: "error" }).metadata();
    if (!["png", "webp"].includes(metadata.format) || (metadata.pages || 1) !== 1)
      throw new Error("format");
    if (metadata.width !== metadata.height || metadata.width < 16 || metadata.width > 512)
      throw new Error("size");
    // No resizing, smoothing or lossy photo conversion for UI artwork.
    const image = await sharp(bytes, { limitInputPixels: 512 * 512, failOn: "error" })
      .webp({ lossless: true, effort: 4 }).toBuffer();
    const thumbnail = await sharp(image).resize(64, 64, { kernel: "nearest" })
      .webp({ lossless: true }).toBuffer();
    return {
      bytes: image,
      width: metadata.width,
      height: metadata.height,
      preview: "data:image/webp;base64," + thumbnail.toString("base64"),
    };
  } catch (error) {
    if (error instanceof IconPackError) throw error;
    throw new IconPackError("Нужен корректный квадратный PNG или WebP 16–512 px, без анимации. SVG импортировать не нужно: в наборе есть PNG-мастера.");
  }
}
