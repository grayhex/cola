import PublicProfile from "../../ui/public-profile.jsx";
export default async function Page({ params }) {
  const { username } = await params;
  return <PublicProfile username={username} />;
}
