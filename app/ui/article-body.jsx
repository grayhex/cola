import { articleBlocks, articleInline } from "../../lib/article-markup.js";
function Inline({ text }) {
  return articleInline(text).map((t, i) =>
    t.type === "text" ? (
      t.text
    ) : t.type === "link" ? (
      <a
        key={i}
        href={t.href}
        rel="nofollow noopener noreferrer"
        target="_blank"
      >
        {t.text}
      </a>
    ) : t.type === "strong" ? (
      <strong key={i}>{t.text}</strong>
    ) : t.type === "em" ? (
      <em key={i}>{t.text}</em>
    ) : (
      <code key={i}>{t.text}</code>
    ),
  );
}
export default function ArticleBody({ body, photos = [] }) {
  return (
    <div className="article-prose">
      {articleBlocks(body).map((b, i) => {
        if (b.type === "image") {
          const photo = photos.find((p) => p.id === b.id);
          return photo ? (
            <figure key={i}>
              <img src={photo.url} alt={b.alt} loading="lazy" />
              {b.alt && <figcaption>{b.alt}</figcaption>}
            </figure>
          ) : null;
        }
        if (b.type === "list")
          return (
            <ul key={i}>
              {b.items.map((s, n) => (
                <li key={n}>
                  <Inline text={s} />
                </li>
              ))}
            </ul>
          );
        if (b.type === "heading") {
          const Tag = b.level === 1 ? "h2" : "h3";
          return (
            <Tag key={i}>
              <Inline text={b.text} />
            </Tag>
          );
        }
        return (
          <p key={i}>
            <Inline text={b.text} />
          </p>
        );
      })}
    </div>
  );
}
