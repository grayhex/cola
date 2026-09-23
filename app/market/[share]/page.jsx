import Market from "../../ui/market.jsx";
import { metadataFor, canonicalPage } from "../../../lib/social-page.js";
export const runtime = "nodejs", dynamic = "force-dynamic";
export async function generateMetadata({ params, searchParams }) {
  return metadataFor("market", (await params).share, await searchParams);
}
export default async function Page({ params, searchParams }) {
  const share = await canonicalPage("market", (await params).share, await searchParams);
  return <Market share={share} />;
}
