import { Node } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { MarkdownManager } from "@tiptap/markdown";
import { Marked } from "marked";
import { joinBlocks, plainExcerpt } from "./excerpt.js";

export const richTextLimit = 200000;
export function safeRichLink(value) {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    /[\u0000-\u0020\u007f]/.test(value)
  )
    return null;
  if (/^\/(?![\/\\])/.test(value) && !value.includes("\\")) return value;
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
const photoId =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
// A reference is not an arbitrary image URL. The reader resolves it only against
// the current article's already-authorized attachment DTOs.
export const PhotoReference = Node.create({
  name: "photoReference",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return { id: { default: "" }, alt: { default: "" } };
  },
  parseHTML() {
    return [
      {
        tag: "span[data-photo-reference]",
        getAttrs: (el) => ({
          id: el.dataset.photoReference,
          alt: el.dataset.alt || "",
        }),
      },
    ];
  },
  renderHTML({ node }) {
    return [
      "span",
      {
        "data-photo-reference": node.attrs.id,
        "data-alt": node.attrs.alt,
        contenteditable: "false",
        class: "rich-photo-reference",
      },
      "Иллюстрация: " + (node.attrs.alt || "без подписи"),
    ];
  },
  markdownTokenName: "image",
  parseMarkdown(token, helpers) {
    const id = String(token.href || "").replace(/^photo:/, "");
    return String(token.href).startsWith("photo:") && photoId.test(id)
      ? helpers.createNode("photoReference", { id, alt: token.text || "" })
      : helpers.createTextNode(token.raw || token.text || "");
  },
  renderMarkdown(node) {
    const alt = String(node.attrs?.alt || "").replace(/[\[\]\\\r\n]/g, " ");
    return `![${alt}](photo:${node.attrs?.id || ""})`;
  },
});
export function richExtensions() {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: {
        openOnClick: false,
        autolink: false,
        linkOnPaste: false,
        isAllowedUri: (url) => !!safeRichLink(url),
      },
      trailingNode: false,
    }),
    PhotoReference,
  ];
}
// Isolated lexer: HTML is literal text, on both server and client. Returning
// undefined deliberately disables Marked's HTML tokenizers (false delegates).
const marked = new Marked({
  gfm: true,
  breaks: true,
  tokenizer: {
    html() {
      return undefined;
    },
    tag() {
      return undefined;
    },
  },
});
const markdown = new MarkdownManager({ marked, extensions: richExtensions() });
const blocks = new Set([
  "doc",
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
  "codeBlock",
  "horizontalRule",
  "hardBreak",
]);
const marks = new Set(["bold", "italic", "underline", "strike", "code"]);
export function cleanRichDocument(node, depth = 0) {
  if (!node || typeof node !== "object" || depth > 40) return null;
  if (node.type === "text") {
    if (!node.text) return null;
    const clean = { type: "text", text: String(node.text) };
    const filtered = (node.marks || []).flatMap((mark) => {
      if (marks.has(mark.type)) return [{ type: mark.type }];
      const href = mark.type === "link" && safeRichLink(mark.attrs?.href);
      return href ? [{ type: "link", attrs: { href } }] : [];
    });
    if (filtered.length) clean.marks = filtered;
    return clean;
  }
  if (node.type === "photoReference")
    return photoId.test(node.attrs?.id || "")
      ? {
          type: node.type,
          attrs: {
            id: node.attrs.id,
            alt: String(node.attrs.alt || "").slice(0, 500),
          },
        }
      : null;
  if (!blocks.has(node.type)) return null;
  const clean = { type: node.type };
  if (node.type === "heading")
    clean.attrs = {
      level: [1, 2, 3].includes(node.attrs?.level) ? node.attrs.level : 2,
    };
  if (node.type === "orderedList")
    clean.attrs = {
      start: Math.min(999999, Math.max(1, Number(node.attrs?.start) || 1)),
    };
  if (node.content)
    clean.content = node.content
      .map((n) => cleanRichDocument(n, depth + 1))
      .filter(Boolean);
  if (["doc", "blockquote", "listItem"].includes(node.type) && clean.content) {
    const content = [];
    for (const child of clean.content) {
      if (["text", "photoReference", "hardBreak"].includes(child.type)) {
        if (content.at(-1)?.type !== "paragraph")
          content.push({ type: "paragraph", content: [] });
        (content.at(-1).content ||= []).push(child);
      } else content.push(child);
    }
    clean.content = content;
  }
  return clean;
}
export function parseRichText(body = "") {
  const source = String(body).slice(0, richTextLimit);
  try {
    const doc = cleanRichDocument(markdown.parse(source));
    return doc?.content?.length
      ? doc
      : { type: "doc", content: [{ type: "paragraph" }] };
  } catch {
    // Historical or unsupported markup remains visible, never evaluated as HTML.
    return {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: source ? [{ type: "text", text: source }] : [],
        },
      ],
    };
  }
}
export function serializeRichText(doc) {
  return markdown.serialize(
    cleanRichDocument(doc) || { type: "doc", content: [] },
  );
}
export function richPlainText(body = "", { images = true } = {}) {
  const visit = (node) =>
    node.type === "hardBreak"
      ? "\n"
      : node.type === "text"
        ? node.text
        : node.type === "photoReference"
          ? images
            ? node.attrs.alt
            : ""
          : (node.content || [])
              .map(visit)
              .join(
                [
                  "doc",
                  "bulletList",
                  "orderedList",
                  "listItem",
                  "blockquote",
                ].includes(node.type)
                  ? "\n"
                  : node.type === "hardBreak"
                    ? "\n"
                    : "",
              );
  return visit(parseRichText(body)).trim();
}
// Card preview without markup: headings and list items read as sentences.
export function richExcerpt(body = "", max = 180) {
  return plainExcerpt(joinBlocks(richPlainText(body, { images: false })), max);
}
