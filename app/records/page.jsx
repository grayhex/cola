import Records from "../ui/records.jsx";
import { indexed } from "../../lib/indexing.js";
export const metadata = {
  title: "Рекорды · ColaBike",
  description:
    "Сборки, о которых говорят: награды и рекорды велосипедов сообщества ColaBike.",
  robots: indexed,
};
export default function Page() {
  return <Records />;
}
