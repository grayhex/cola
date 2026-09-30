import CommunityPage from "../ui/community-page.tsx";
export const metadata = {
  title: "Сохранённое · ColaBike",
  robots: { index: false },
};
export default function Page() {
  return <CommunityPage kind="saved" />;
}
