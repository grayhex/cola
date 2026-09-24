import ExperienceLanding from "../../../ui/experience-landing.jsx";
import { landing, landingMetadata } from "../../landing-page.js";
export const runtime = "nodejs",
  dynamic = "force-dynamic";
export async function generateMetadata({ params }) {
  const { brand, model } = await params;
  return landingMetadata(await landing("model", brand, model));
}
export default async function Page({ params }) {
  const { brand, model } = await params;
  return <ExperienceLanding data={await landing("model", brand, model)} />;
}
