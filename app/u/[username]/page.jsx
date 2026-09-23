import PublicProfile from "../../ui/public-profile.jsx";
import { metadataFor, canonicalPage } from "../../../lib/social-page.js";
export const runtime = "nodejs", dynamic = "force-dynamic";
export async function generateMetadata({ params, searchParams }) {
  return metadataFor("profile", (await params).username, await searchParams, { legacyProfile: true });
}
export default async function Page({ params, searchParams }) {
  const username = await canonicalPage("profile", (await params).username, await searchParams, { legacyProfile: true });
  return <PublicProfile username={username} />;
}
