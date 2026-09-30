import Garage from "../ui/garage.tsx";
import { indexed } from "../../lib/indexing.ts";
export const metadata = {
  title: "Велосипеды · ColaBike",
  description:
    "Велосипеды участников ColaBike: сборки, компоненты, фотографии и истории владельцев.",
  robots: indexed,
};
export default function Page() {
  return <Garage />;
}
