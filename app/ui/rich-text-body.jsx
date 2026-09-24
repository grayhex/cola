import { safeRichLink } from "../../lib/rich-link.js";
import styles from "./rich-text.module.css";

// Renders a document from `parseRichText`. The server parses the Markdown
// (entry, article and comment DTOs carry `bodyDoc`), so a reader never
// downloads the parser or the editor (#117).
export default function RichTextBody({ doc, photos = [], className = "" }) {
  function render(node, key) {
    if (node.type === "text") {
      let text = node.text;
      for (const mark of node.marks || []) {
        const tags = {
          bold: "strong",
          italic: "em",
          underline: "u",
          strike: "s",
          code: "code",
        };
        if (tags[mark.type]) {
          const Tag = tags[mark.type];
          text = <Tag>{text}</Tag>;
        } else if (mark.type === "link" && safeRichLink(mark.attrs?.href))
          text = (
            <a
              href={mark.attrs.href}
              target="_blank"
              rel="nofollow noopener noreferrer"
            >
              {text}
            </a>
          );
      }
      return <span key={key}>{text}</span>;
    }
    if (node.type === "photoReference") {
      const photo = photos.find((p) => p.id === node.attrs.id);
      // Only application attachment routes, never caller-supplied external URLs.
      if (
        !photo ||
        !/^\/api\/journal\/media\/[a-f0-9-]+$/i.test(photo.url || "")
      )
        return null;
      return (
        <span className={styles.photo} key={key}>
          <img src={photo.url} alt={node.attrs.alt} loading="lazy" />
          {node.attrs.alt && <span>{node.attrs.alt}</span>}
        </span>
      );
    }
    if (node.type === "hardBreak") return <br key={key} />;
    if (node.type === "horizontalRule") return <hr key={key} />;
    const children = (node.content || []).map(render);
    if (node.type === "codeBlock")
      return (
        <pre key={key}>
          <code>{children}</code>
        </pre>
      );
    const tags = {
      paragraph: "p",
      heading: node.attrs?.level === 1 ? "h2" : "h3",
      bulletList: "ul",
      orderedList: "ol",
      listItem: "li",
      blockquote: "blockquote",
    };
    const Tag = tags[node.type];
    return Tag ? (
      <Tag key={key} {...(Tag === "ol" ? { start: node.attrs?.start } : {})}>
        {children}
      </Tag>
    ) : (
      children
    );
  }
  return (
    <div className={[styles.prose, className].filter(Boolean).join(" ")}>
      {(doc?.content || []).map(render)}
    </div>
  );
}
