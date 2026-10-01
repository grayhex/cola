import { ArticlePage } from "../../ui/articles.tsx";
import { articleMetadata, articlePage } from "../../../lib/social-page.ts";
export const runtime = "nodejs",
  dynamic = "force-dynamic";
export async function generateMetadata({
  params,
}: {
  params: Promise<{ share: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return articleMetadata((await params).share);
}
export default async function Page({
  params,
}: {
  params: Promise<{ share: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const initial = await articlePage((await params).share);
  return (
    <ArticlePage
      key={initial.article.shareId}
      share={initial.article.shareId}
      initial={initial}
    />
  );
}
