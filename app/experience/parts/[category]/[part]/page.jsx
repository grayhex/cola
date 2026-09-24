import ExperienceLanding from "../../../../ui/experience-landing.jsx";
import { landing, landingMetadata } from "../../../landing-page.js";
export const runtime = "nodejs",
  dynamic = "force-dynamic";
export async function generateMetadata({ params }) {
  const { category, part } = await params;
  return landingMetadata(await landing("part", category, part));
}
export default async function Page({ params }) {
  const { category, part } = await params;
  return <ExperienceLanding data={await landing("part", category, part)} />;
}
