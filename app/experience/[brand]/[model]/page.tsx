import ExperienceLanding from "../../../ui/experience-landing.tsx";
import { landing, landingMetadata } from "../../landing-page.ts";
export const runtime = "nodejs",
  dynamic = "force-dynamic";
export async function generateMetadata({
  params,
}: {
  params: Promise<{ brand: string; model: string }>;
}) {
  const { brand, model } = await params;
  return landingMetadata(await landing("model", brand, model));
}
export default async function Page({
  params,
}: {
  params: Promise<{ brand: string; model: string }>;
}) {
  const { brand, model } = await params;
  return <ExperienceLanding data={await landing("model", brand, model)} />;
}
