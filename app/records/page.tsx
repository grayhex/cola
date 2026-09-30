import Records from "../ui/records.tsx";
import { indexed } from "../../lib/indexing.ts";
export const metadata = {
  title: "Рекорды · ColaBike",
  description:
    "Сборки, о которых говорят: награды и рекорды велосипедов сообщества ColaBike.",
  robots: indexed,
};
export default function Page() {
  return <Records />;
}
