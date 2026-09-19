import { currentUser } from "../../lib/auth.js";
import About from "./about.jsx";
export const metadata = { title: "О проекте · ColaBike" };
export default async function Page() {
  return <About user={await currentUser()} />;
}
