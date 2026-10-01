import ExperienceLanding from "../../../../ui/experience-landing.tsx";
import { landing, landingMetadata } from "../../../landing-page.ts";
export const runtime = "nodejs",
  dynamic = "force-dynamic";
export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string; part: string }>;
}) {
  const { category, part } = await params;
  return landingMetadata(await landing("part", category, part));
}
export default async function Page({
  params,
}: {
  params: Promise<{ category: string; part: string }>;
}) {
  const { category, part } = await params;
  return <ExperienceLanding data={await landing("part", category, part)} />;
}
