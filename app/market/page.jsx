import Market from "../ui/market.jsx";
import { indexed } from "../../lib/indexing.js";
export const metadata = {
  title: "Рынок · ColaBike",
  description:
    "Объявления ColaBike: продажа, покупка, обмен и бесплатная передача велосипедов и деталей.",
  robots: indexed,
};
export default function Page() {
  return <Market />;
}
