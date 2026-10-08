import type { SocialPreview as SocialPreviewType } from "./social-preview.ts";
import type { CardData as CardDataType } from "./social-card.ts";
import { errorCode } from "./errors.ts";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { SharpInput } from "sharp";
import { cachedDerivative } from "./media-cache.ts";
import { logError } from "./observability.ts";
import {
  cardContent,
  cardHeight,
  cardVersion,
  cardWidth,
  renderCard,
} from "./social-card.ts";

const fallback =
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<rect width="1200" height="630" fill="#f6f7f8"/><g fill="none" stroke="#253446" stroke-width="12" stroke-linecap="round" stroke-linejoin="round">
<circle cx="480" cy="240" r="65"/><circle cx="720" cy="240" r="65"/><path d="M480 240l65-100 80 100H480l125-90h60l55 90M535 130h45M655 125h35"/></g>
<text x="600" y="425" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="70" fill="#253446">ColaBike</text></svg>`);

// A bare, safe file name of an uploaded original inside UPLOAD_DIR.
const safeFilename = (filename: string | null | undefined) =>
  filename &&
  filename === path.basename(filename) &&
  /^[a-zA-Z0-9_-]+\.(?:webp|png|jpe?g)$/i.test(filename)
    ? filename
    : null;
async function readUpload(filename: string | null, uploadDir: string) {
  if (!filename) return null;
  try {
    return await readFile(
      /*turbopackIgnore: true*/ path.join(
        /*turbopackIgnore: true*/ uploadDir,
        filename,
      ),
    );
  } catch (error) {
    if (errorCode(error) === "ENOENT" || errorCode(error) === "EISDIR")
      return null;
    throw error;
  }
}
// The photo alone, as before the branded cards: used when a card fails. An
// unreadable upload still yields the neutral image, never an error page.
async function plainImage(bytes: SharpInput | SharpInput[] | null | undefined) {
  if (bytes) {
    try {
      return await sharp(bytes, { limitInputPixels: 40000000 })
        .rotate()
        .resize({
          width: 1200,
          height: 630,
          fit: "inside",
          withoutEnlargement: true,
        })
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: 88 })
        .toBuffer();
    } catch {
      // Fall through to the neutral image.
    }
  }
  return sharp(fallback).jpeg({ quality: 88 }).toBuffer();
}
// Avatars stay a circle; other photos fill the card. A card is a JPEG, which
// has no transparency, so a photo without its backdrop (#370) is laid on a
// light one, as a studio photograph is: on the card's dark ground a dark frame
// would disappear. The stored photo keeps its transparency.
export async function photoData(
  bytes: SharpInput | SharpInput[] | undefined,
  kind: string,
) {
  const [width, height] =
    kind === "profile" ? [300, 300] : [cardWidth, cardHeight];
  const clear = !(await sharp(bytes, { limitInputPixels: 40000000 }).stats())
    .isOpaque;
  const jpeg = await sharp(bytes, { limitInputPixels: 40000000 })
    .rotate()
    .resize(width, height, { fit: "cover", position: sharp.strategy.attention })
    .flatten({ background: clear ? "#f6f7f8" : "#111315" })
    .jpeg({ quality: 86 })
    .toBuffer();
  return "data:image/jpeg;base64," + jpeg.toString("base64");
}

// Branded 1200x630 card (#72), cached under a key of everything drawn on it.
// Callers pass a preview that has just passed the public gate, so a cached
// card is never served for a page that is no longer public.
export async function renderSocialImage(
  preview: SocialPreviewType & { card?: CardDataType | null },
  { uploadDir = process.env.UPLOAD_DIR || "uploads", env = process.env } = {},
) {
  const filename = safeFilename(preview.image?.filename);
  const content = cardContent(preview.kind, preview.title, preview.card || {});
  const key = createHash("sha256")
    .update(JSON.stringify([cardVersion, content, filename]))
    .digest("hex")
    .slice(0, 40);
  try {
    return await cachedDerivative(
      "social-card-" + key + ".jpg",
      async () => {
        const bytes = await readUpload(filename, uploadDir);
        return renderCard(
          content,
          bytes && (await photoData(bytes, preview.kind)),
        );
      },
      env,
    );
  } catch (error) {
    logError("social_card_failed", error);
    return plainImage(await readUpload(filename, uploadDir).catch(() => null));
  }
}
