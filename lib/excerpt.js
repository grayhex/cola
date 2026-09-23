// Card and feed previews. The input is already plain text; markup is removed by callers.
export function plainExcerpt(text, max = 180) {
  const flat = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(" ");
  // Prefer a word boundary unless it would discard most of the preview.
  const word = space > max * 0.6 ? cut.slice(0, space) : cut;
  return word.replace(/[\s.,;:!?…—–-]+$/u, "") + "…";
}

// Block texts (headings, paragraphs, list items) read as sentences in one line.
export function joinBlocks(text) {
  const blocks = String(text ?? "")
    .split(/\n+/)
    .map((block) => block.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return blocks
    .map((block, i) =>
      i < blocks.length - 1 && !/[.!?…:;,]$/u.test(block) ? block + "." : block,
    )
    .join(" ");
}
