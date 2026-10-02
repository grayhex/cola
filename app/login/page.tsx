import AuthPage from "../ui/auth-page.tsx";
import { identityNotice } from "../../lib/identity-messages.ts";
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ identity?: string | string[] }>;
}) {
  const { identity } = await searchParams;
  return (
    <AuthPage
      notice={
        identityNotice(typeof identity === "string" ? identity : "") || ""
      }
    />
  );
}
