import DiscoverySearch from "../ui/discovery-search.jsx";
import ExperienceSearch from "../ui/experience-search.jsx";
export const metadata = { title: "Поиск · ColaBike" };
export default async function Page({ searchParams }) {
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
    ].some((k) => params[k]) || ["journal", "users"].includes(params.type);
  return advanced ? <ExperienceSearch /> : <DiscoverySearch />;
}
