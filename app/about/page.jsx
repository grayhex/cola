import { currentUser } from "../../lib/auth.js";
import About from "./about.jsx";
import { db } from "../../lib/db.js";
import { siteStatistics } from "../../lib/site-statistics.js";
import { indexed } from "../../lib/indexing.js";
export const metadata = {
  title: "О проекте · ColaBike",
  description:
    "ColaBike: люди, велосипеды и истории. Соберите велосипед, покажите сборку, добавьте приключения.",
  robots: indexed,
};
export default async function Page() {
  return (
    <About user={await currentUser()} statistics={await siteStatistics(db)} />
  );
}
