// A deliberately small Markdown subset. HTML is always text; image references
// resolve only through the article's own authenticated attachment list.
export function articleBlocks(body = "") {
  const blocks = [];
  let paragraph = [];
  let list = [];
  const flush = () => {
    if (paragraph.length) {
      blocks.push({ type: "paragraph", text: paragraph.join("\n") });
      paragraph = [];
    }
    if (list.length) {
      blocks.push({ type: "list", items: list });
      list = [];
    }
  };
  for (const line of body.split(/\r?\n/)) {
    const heading = /^(#{1,3})\s+(.+)$/.exec(line),
      image = /^!\[([^\]]*)\]\(photo:([a-f0-9-]{36})\)$/.exec(line.trim()),
      item = /^[-*]\s+(.+)$/.exec(line);
    if (!line.trim()) {
      flush();
      continue;
    }
    if (heading) {
      flush();
      blocks.push({
        type: "heading",
        level: heading[1].length,
        text: heading[2],
      });
    } else if (image) {
      flush();
      blocks.push({ type: "image", alt: image[1], id: image[2] });
    } else if (item) {
      if (paragraph.length) flush();
      list.push(item[1]);
    } else {
      if (list.length) flush();
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}
export function articleInline(text) {
  const pattern =
    /(\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|`([^`\n]+)`|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\))/g;
  const result = [];
  let from = 0;
  for (const m of text.matchAll(pattern)) {
    if (m.index > from)
      result.push({ type: "text", text: text.slice(from, m.index) });
    result.push(
      m[2]
        ? { type: "strong", text: m[2] }
        : m[3]
          ? { type: "em", text: m[3] }
          : m[4]
            ? { type: "code", text: m[4] }
            : { type: "link", text: m[5], href: m[6] },
    );
    from = m.index + m[0].length;
  }
  if (from < text.length) result.push({ type: "text", text: text.slice(from) });
  return result;
}
