import RideIntents from "../ui/ride-intents.jsx";
import { hidden } from "../../lib/indexing.js";
export const metadata = { title: "Хочу кататься · ColaBike", robots: hidden };
export default function Page() {
  return <RideIntents />;
}
