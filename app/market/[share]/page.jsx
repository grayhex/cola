import Market from "../../ui/market.jsx";
import { metadataFor, canonicalPage, sharePath, pageData } from "../../../lib/social-page.js";
export const runtime = "nodejs", dynamic = "force-dynamic";
export async function generateMetadata({ params, searchParams }) {
  return metadataFor("market", (await params).share, await searchParams);
}
export default async function Page({ params, searchParams }) {
  const reference = (await params).share;
  const share = await canonicalPage("market", reference, await searchParams);
  return (
    <Market
      key={share}
      share={share}
      sharePath={await sharePath("market", reference)}
      initial={await pageData("market", share)}
    />
  );
}
