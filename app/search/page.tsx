import DiscoverySearch from "../ui/discovery-search.tsx";
import ExperienceSearch from "../ui/experience-search.tsx";
export const metadata = { title: "Поиск · ColaBike" };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  // Keep existing model/author/journal bookmarks and advanced filters working.
  const advanced =
    [
      "brand",
      "model",
      "similar",
      "purpose",
      "year",
      "kind",
      "componentCategory",
    ].some((k) => params[k]) ||
    (typeof params.type === "string" &&
      ["journal", "users"].includes(params.type));
  return advanced ? <ExperienceSearch /> : <DiscoverySearch />;
}
