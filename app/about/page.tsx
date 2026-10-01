import { currentViewer } from "../../lib/viewer.ts";
import About from "./about.tsx";
import { db } from "../../lib/db.ts";
import { siteStatistics } from "../../lib/site-statistics.ts";
import { indexed } from "../../lib/indexing.ts";
export const metadata = {
  title: "О проекте · ColaBike",
  description:
    "ColaBike: люди, велосипеды и истории. Соберите велосипед, покажите сборку, добавьте приключения.",
  robots: indexed,
};
export default async function Page() {
  return (
    <About user={await currentViewer()} statistics={await siteStatistics(db)} />
  );
}
