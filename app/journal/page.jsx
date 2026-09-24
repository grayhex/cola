import CommunityPage from "../ui/community-page.jsx";
import { indexed } from "../../lib/indexing.js";
export const metadata = {
  title: "Журнал · ColaBike",
  description:
    "Журнал владельцев велосипедов: сборки и апгрейды, обслуживание, впечатления и вопросы.",
  robots: indexed,
};
export default function Page() {
  return <CommunityPage kind="journal" />;
}
