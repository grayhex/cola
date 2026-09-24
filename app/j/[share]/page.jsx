import JournalPage from "../../ui/journal-page.jsx";
import { metadataFor, canonicalPage, sharePath, pageData } from "../../../lib/social-page.js";
export const runtime = "nodejs", dynamic = "force-dynamic";
export async function generateMetadata({ params, searchParams }) {
  return metadataFor("journal", (await params).share, await searchParams);
}
export default async function Page({ params, searchParams }) {
  const reference = (await params).share;
  const share = await canonicalPage("journal", reference, await searchParams);
  return (
    <JournalPage
      key={share}
      share={share}
      sharePath={await sharePath("journal", reference)}
      initial={await pageData("journal", share)}
    />
  );
}
