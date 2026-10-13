import { currentUser } from "../../../lib/auth.ts";
import { db } from "../../../lib/db.ts";
import { clubEligibility } from "../../../lib/clubs.ts";
import ClubEditor from "../../ui/club-editor.tsx";
export const dynamic = "force-dynamic",
  runtime = "nodejs";
export const metadata = {
  title: "Создать клуб · ColaBike",
  robots: { index: false },
};
export default async function Page() {
  const user = await currentUser();
  return (
    <ClubEditor
      eligibility={user ? await clubEligibility(db, user.id) : null}
    />
  );
}
