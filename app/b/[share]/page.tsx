import Garage from "../../ui/garage.tsx";
import {
  metadataFor,
  canonicalPage,
  pageData,
} from "../../../lib/social-page.ts";
export const runtime = "nodejs",
  dynamic = "force-dynamic";
export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ share: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return metadataFor("bike", (await params).share, await searchParams);
}
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ share: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const share = await canonicalPage(
    "bike",
    (await params).share,
    await searchParams,
  );
  return (
    <Garage key={share} share={share} initial={await pageData("bike", share)} />
  );
}
