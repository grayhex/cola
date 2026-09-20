import { currentUser } from "../../lib/auth.js";
import About from "./about.jsx";
import { db } from "../../lib/db.js";
import { siteStatistics } from "../../lib/site-statistics.js";
export const metadata = { title: "О проекте · ColaBike" };
export default async function Page() {
  return (
    <About user={await currentUser()} statistics={await siteStatistics(db)} />
  );
}
