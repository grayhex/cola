import { ArticlePage } from "../../ui/articles.jsx";
import { articleMetadata, articlePage } from "../../../lib/social-page.js";
export const runtime = "nodejs", dynamic = "force-dynamic";
export async function generateMetadata({ params }) {
  return articleMetadata((await params).share);
}
export default async function Page({ params }) {
  const initial = await articlePage((await params).share);
  return (
    <ArticlePage
      key={initial.article.shareId}
      share={initial.article.shareId}
      initial={initial}
    />
  );
}
