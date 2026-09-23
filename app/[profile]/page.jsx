import { notFound } from "next/navigation";
import PublicProfile from "../ui/public-profile.jsx";
import { metadataFor, canonicalPage } from "../../lib/social-page.js";
export const runtime = "nodejs", dynamic = "force-dynamic";
function usernameFrom(profile) {
  if (!/^@[a-z0-9._-]{3,30}$/i.test(profile)) notFound();
  return profile.slice(1);
}
export async function generateMetadata({ params, searchParams }) {
  return metadataFor("profile", usernameFrom((await params).profile), await searchParams);
}
export default async function Page({ params, searchParams }) {
  const username = await canonicalPage("profile", usernameFrom((await params).profile), await searchParams);
  return <PublicProfile username={username} />;
}
