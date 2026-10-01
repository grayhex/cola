import RidePage from "../../ui/ride-page.tsx";
import {
  metadataFor,
  canonicalPage,
  sharePath,
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
  return metadataFor("ride", (await params).share, await searchParams);
}
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ share: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
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
