import type { RichTextBodyProps } from "./rich-text-body.tsx";
import RichTextBody from "./rich-text-body.tsx";
export default function ArticleBody(
  props: Omit<RichTextBodyProps, "className">,
) {
  return <RichTextBody {...props} className="article-prose" />;
}
