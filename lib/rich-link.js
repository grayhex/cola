// Links a reader may follow from rich text: a same-site path or an http(s)
// address without credentials. The renderer needs only this, so readers do
// not download the Markdown parser and the editor with it (#117).
export function safeRichLink(value) {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    /[\u0000-\u0020\u007f]/.test(value)
  )
    return null;
  if (/^\/(?![/\\])/.test(value) && !value.includes("\\")) return value;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
