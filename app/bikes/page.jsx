import Garage from "../ui/garage.jsx";
import { indexed } from "../../lib/indexing.js";
export const metadata = {
  title: "Велосипеды · ColaBike",
  description:
    "Велосипеды участников ColaBike: сборки, компоненты, фотографии и истории владельцев.",
  robots: indexed,
};
export default function Page() {
  return <Garage />;
}
