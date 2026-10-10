import { redirect } from "next/navigation";
import Home from "./ui/home.tsx";
import type { Metadata } from "next";
import { getSite } from "../lib/site.ts";
import { homeMetadata } from "../lib/social-metadata.ts";
export async function generateMetadata(): Promise<Metadata> {
  return homeMetadata((await getSite()).settings);
}
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
