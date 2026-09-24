import Rides from "./rides.jsx";
import { indexed } from "../../lib/indexing.js";
export const metadata = {
  title: "Покатушки · ColaBike",
  description:
    "Покатушки сообщества ColaBike: маршруты, треки, километры и планы на выезды.",
  robots: indexed,
};
export default function Page() {
  return <Rides />;
}
