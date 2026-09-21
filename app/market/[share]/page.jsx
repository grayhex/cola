import Market from "../../ui/market.jsx";
export const metadata = { title: "Объявление · ColaBike" };
export default async function Page({ params }) {
  const { share } = await params;
  return <Market share={share} />;
}
