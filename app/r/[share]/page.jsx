import RidePage from "../../ui/ride-page.jsx";
import { metadataFor, canonicalPage, sharePath } from "../../../lib/social-page.js";
export const runtime = "nodejs", dynamic = "force-dynamic";
export async function generateMetadata({ params, searchParams }) {
  return metadataFor("ride", (await params).share, await searchParams);
}
export default async function Page({ params, searchParams }) {
  const reference = (await params).share;
  const share = await canonicalPage("ride", reference, await searchParams);
  return <RidePage share={share} sharePath={await sharePath("ride", reference)} />;
}
