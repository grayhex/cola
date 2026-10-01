import PublicProfile from "../../ui/public-profile.tsx";
import { metadataFor, canonicalPage } from "../../../lib/social-page.ts";
export const runtime = "nodejs",
  dynamic = "force-dynamic";
export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return metadataFor("profile", (await params).username, await searchParams, {
    legacyProfile: true,
  });
}
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const username = await canonicalPage(
    "profile",
    (await params).username,
    await searchParams,
    { legacyProfile: true },
  );
  return <PublicProfile username={username} />;
}
