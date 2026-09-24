import RidePage from "../../ui/ride-page.jsx";
import { metadataFor, canonicalPage, sharePath, pageData } from "../../../lib/social-page.js";
export const runtime = "nodejs", dynamic = "force-dynamic";
export async function generateMetadata({ params, searchParams }) {
  return metadataFor("ride", (await params).share, await searchParams);
}
export default async function Page({ params, searchParams }) {
  const reference = (await params).share,
    search = await searchParams;
  const share = await canonicalPage("ride", reference, search);
  return (
    <RidePage
      key={share}
      share={share}
      sharePath={await sharePath("ride", reference)}
      // The owner's view (?owner=1) has its own endpoint and loads in the browser.
      initial={search.owner === "1" ? null : await pageData("ride", share)}
    />
  );
}
