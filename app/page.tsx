import { redirect } from "next/navigation";
import Home from "./ui/home.tsx";
import { indexed } from "../lib/indexing.ts";
export const metadata = { robots: indexed };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  // Old gallery bookmarks preserve sort, filters, pagination and search.
  if (["sort", "category", "q", "page"].some((key) => params[key]))
    redirect(
      "/bikes?" +
        new URLSearchParams(
          Object.entries(params).map(([key, value]) => [key, String(value)]),
        ),
    );
  return <Home />;
}
