import { notFound } from "next/navigation";
import { currentViewer } from "../../../lib/viewer.js";
import UiKit from "./ui-kit.jsx";
export const metadata = { title: "UI Kit · ColaBike" };
// The design system reference (#127): administrators only, or anyone while
// developing locally. Everyone else gets the ordinary 404.
export default async function Page() {
  const viewer = await currentViewer();
  if (process.env.NODE_ENV !== "development" && viewer?.role !== "admin")
    notFound();
  return <UiKit />;
}
