import Market from "../../ui/market.jsx";
import { metadataFor, canonicalPage, sharePath } from "../../../lib/social-page.js";
export const runtime = "nodejs", dynamic = "force-dynamic";
export async function generateMetadata({ params, searchParams }) {
  return metadataFor("market", (await params).share, await searchParams);
}
export default async function Page({ params, searchParams }) {
  const reference = (await params).share;
  const share = await canonicalPage("market", reference, await searchParams);
  return <Market share={share} sharePath={await sharePath("market", reference)} />;
}
