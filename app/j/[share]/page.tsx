import JournalPage from "../../ui/journal-page.tsx";
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
  return metadataFor("journal", (await params).share, await searchParams);
}
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ share: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
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
