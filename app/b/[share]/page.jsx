import Garage from "../../ui/garage.jsx";
import { metadataFor, canonicalPage } from "../../../lib/social-page.js";
export const runtime = "nodejs", dynamic = "force-dynamic";
export async function generateMetadata({ params, searchParams }) {
  return metadataFor("bike", (await params).share, await searchParams);
}
export default async function Page({ params, searchParams }) {
  const share = await canonicalPage("bike", (await params).share, await searchParams);
  return <Garage share={share} />;
}
