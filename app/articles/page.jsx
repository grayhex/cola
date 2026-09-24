import { Articles } from "../ui/articles.jsx";
import { indexed } from "../../lib/indexing.js";
export const metadata = {
  title: "Статьи · ColaBike",
  description:
    "База знаний велосипедистов: обслуживание, компоненты и полезный опыт.",
  robots: indexed,
};
export default function Page() {
  return <Articles />;
}
