import Garage from "../../ui/garage.jsx";
export default async function Page({ params }) {
  const { share } = await params;
  return <Garage share={share} />;
}
