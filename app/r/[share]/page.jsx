import RidePage from "../../ui/ride-page.jsx";
export default async function Page({ params }) {
  return <RidePage share={(await params).share} />;
}
