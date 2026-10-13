import type { ReactNode } from "react";
import { SocialHeader, SocialFooter } from "../ui/social-primitives.tsx";
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <SocialHeader />
      <main>{children}</main>
      <SocialFooter />
    </>
  );
}
