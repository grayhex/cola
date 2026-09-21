import { redirect } from "next/navigation";
import Home from "./ui/home.jsx";
export default async function Page({ searchParams }) {
  const params = await searchParams;
  // Old gallery bookmarks preserve sort, filters, pagination and search.
  if (["sort", "category", "q", "page"].some((key) => params[key]))
    redirect("/bikes?" + new URLSearchParams(params));
  return <Home />;
}
