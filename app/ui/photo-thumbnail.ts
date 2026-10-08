// The small picture of a file the person chose, for the wizard's draft (#370):
// drawn from the decoded image, so the page holds a few kilobytes instead of
// the file, and nothing but an image the browser itself made goes into an
// <img>. Orientation is already applied by the decoder.
export function thumbnailOf(image: ImageBitmap, edge = 320) {
  const scale = Math.min(1, edge / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext("2d");
  if (!context) return "";
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/webp", 0.8);
}
