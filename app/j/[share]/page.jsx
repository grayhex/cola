import JournalPage from "../../ui/journal-page.jsx";
import { metadataFor, canonicalPage } from "../../../lib/social-page.js";
export const runtime = "nodejs", dynamic = "force-dynamic";
export async function generateMetadata({ params, searchParams }) {
  return metadataFor("journal", (await params).share, await searchParams);
}
export default async function Page({ params, searchParams }) {
  const share = await canonicalPage("journal", (await params).share, await searchParams);
  return <JournalPage share={share} />;
}
