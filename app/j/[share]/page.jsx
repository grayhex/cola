import JournalPage from "../../ui/journal-page.jsx";
export const dynamic = "force-dynamic";
export default async function Page({ params }) {
  return <JournalPage share={(await params).share} />;
}
