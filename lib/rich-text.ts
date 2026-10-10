import { Node } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import {
  Table,
  TableRow,
  TableCell,
  TableHeader,
} from "@tiptap/extension-table";
import StarterKit from "@tiptap/starter-kit";
import { MarkdownManager } from "@tiptap/markdown";
import { Marked, marked as globalMarked } from "marked";
import { joinBlocks, plainExcerpt } from "./excerpt.ts";
import { safeRichLink } from "./rich-link.ts";

export { safeRichLink };

export const richTextLimit = 200000;
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
    const alt = String(node.attrs?.alt || "").replace(/[[\]\\\r\n]/g, " ");
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
    Table.extend({
      renderMarkdown(node, helpers) {
        const rows = node.content || [];
        const count = Math.max(
          0,
          ...rows.map((row) => row.content?.length || 0),
        );
        if (!count) return "";
        const line = (row?: JSONContent) =>
          "| " +
          Array.from({ length: count }, (_, index) =>
            helpers
              .renderChildren(row?.content?.[index]?.content || [])
              .replace(/\|/g, "\\|")
              .replace(/\r?\n/g, " / ")
              .trim(),
          ).join(" | ") +
          " |";
        const headed = rows[0]?.content?.every(
          (cell) => cell.type === "tableHeader",
        );
        return [
          line(headed ? rows[0] : undefined),
          "| " + Array(count).fill("---").join(" | ") + " |",
          ...rows.slice(headed ? 1 : 0).map(line),
        ].join("\n");
      },
    }).configure({ resizable: false, renderWrapper: true }),
    TableRow,
    TableHeader,
    TableCell,
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
// Supply the function-shaped SDK contract while keeping every lexer extension
// and option on our isolated instance.
const instanceMarked: typeof globalMarked = Object.assign(marked.parse, {
  ...globalMarked,
  parseInline: marked.parseInline,
  lexer: globalMarked.lexer,
  parser: globalMarked.parser,
  walkTokens: marked.walkTokens.bind(marked),
  use(...extensions: Parameters<typeof marked.use>) {
    marked.use(...extensions);
    return instanceMarked;
  },
  setOptions(options: Parameters<typeof marked.setOptions>[0]) {
    marked.setOptions(options);
    return instanceMarked;
  },
  options(options: Parameters<typeof marked.options>[0]) {
    marked.options(options);
    return instanceMarked;
  },
});
Object.defineProperty(instanceMarked, "defaults", {
  get: () => marked.defaults,
});
instanceMarked.parse = instanceMarked;
const markdown = new MarkdownManager({
  marked: instanceMarked,
  extensions: richExtensions(),
});
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
  "table",
  "tableRow",
  "tableCell",
  "tableHeader",
]);
const marks = new Set(["bold", "italic", "underline", "strike", "code"]);
export function cleanRichDocument(
  node: JSONContent | null | undefined,
  depth = 0,
): JSONContent | null {
  if (!node || typeof node !== "object" || depth > 40) return null;
  if (node.type === "text") {
    if (!node.text) return null;
    const clean: JSONContent = { type: "text", text: String(node.text) };
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
            id: node.attrs?.id,
            alt: String(node.attrs?.alt || "").slice(0, 500),
          },
        }
      : null;
  if (!blocks.has(node.type || "")) return null;
  if (node.type === "table") {
    const rows = node.content || [];
    const width = rows[0]?.content?.length || 0;
    const simple =
      width > 0 &&
      rows.every(
        (row, index) =>
          row.type === "tableRow" &&
          row.content?.length === width &&
          row.content.every(
            (cell) =>
              ["tableCell", "tableHeader"].includes(cell.type || "") &&
              (cell.type !== "tableHeader" ||
                (index === 0 &&
                  row.content?.every(
                    (other) => other.type === "tableHeader",
                  ))) &&
              !(
                Number(cell.attrs?.colspan || 1) > 1 ||
                Number(cell.attrs?.rowspan || 1) > 1
              ) &&
              cell.content?.length === 1 &&
              cell.content.every((child) => child.type === "paragraph"),
          ),
      );
    if (!simple) {
      const text = (child: JSONContent, level = 0): string =>
        level > 40
          ? ""
          : child.type === "text"
            ? child.text || ""
            : (child.content || [])
                .map((item) => text(item, level + 1))
                .join(child.type === "tableRow" ? " | " : " / ");
      return {
        type: "paragraph",
        content: [
          {
            type: "text",
            text:
              "Таблица преобразована в текст (сложная структура).\n" +
              rows.map((row) => text(row)).join("\n"),
          },
        ],
      };
    }
  }
  const clean: JSONContent = { type: node.type };
  if (node.type === "heading")
    clean.attrs = {
      level: [1, 2, 3].includes(node.attrs?.level) ? node.attrs?.level : 2,
    };
  if (node.type === "orderedList")
    clean.attrs = {
      start: Math.min(999999, Math.max(1, Number(node.attrs?.start) || 1)),
    };
  if (node.content)
    clean.content = node.content
      .map((n) => cleanRichDocument(n, depth + 1))
      .filter((n): n is JSONContent => !!n);
  if (
    ["doc", "blockquote", "listItem"].includes(node.type || "") &&
    clean.content
  ) {
    // The Markdown parser returns a picture alone on its line without its
    // paragraph (an unsafe one becomes its text). Each gets a paragraph of
    // its own and never joins the paragraph before it (#128).
    const content: JSONContent[] = [];
    for (const child of clean.content)
      content.push(
        ["text", "photoReference", "hardBreak"].includes(child.type || "")
          ? { type: "paragraph", content: [child] }
          : child,
      );
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
export function serializeRichText(doc: JSONContent) {
  return markdown.serialize(
    cleanRichDocument(doc) || { type: "doc", content: [] },
  );
}
export function richPlainText(body = "", { images = true } = {}) {
  const visit = (node: JSONContent): string =>
    node.type === "hardBreak"
      ? "\n"
      : node.type === "text"
        ? node.text || ""
        : node.type === "photoReference"
          ? images
            ? node.attrs?.alt || ""
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
                  "table",
                ].includes(node.type || "")
                  ? "\n"
                  : node.type === "tableRow"
                    ? " | "
                    : "",
              );
  return visit(parseRichText(body)).trim();
}
// Card preview without markup: headings and list items read as sentences.
export function richExcerpt(body = "", max = 180) {
  return plainExcerpt(joinBlocks(richPlainText(body, { images: false })), max);
}
