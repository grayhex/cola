import { ArticlePage } from "../../ui/articles.jsx";
export const metadata = { title: "Статья · ColaBike" };
export default async function Page({ params }) {
  const { share } = await params;
  return <ArticlePage share={share} />;
}
