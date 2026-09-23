import RidePage from "../../ui/ride-page.jsx";
import { metadataFor, canonicalPage } from "../../../lib/social-page.js";
export const runtime = "nodejs", dynamic = "force-dynamic";
export async function generateMetadata({ params, searchParams }) {
  return metadataFor("ride", (await params).share, await searchParams);
}
export default async function Page({ params, searchParams }) {
  const share = await canonicalPage("ride", (await params).share, await searchParams);
  return <RidePage share={share} />;
}
