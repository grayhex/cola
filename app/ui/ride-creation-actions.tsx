"use client";
import Link from "next/link";
import SiteIcon from "./site-icon.tsx";
import { guestRidingHref, ridingHref } from "../../lib/navigation.ts";

// Discovery offers planning only; imports live under «Интеграции и импорт».
// A guest's link asks for registration first (#378).
export default function RideCreationActions({
  signedIn = true,
}: {
  signedIn?: boolean;
}) {
  return (
    <Link
      className="button"
      href={signedIn ? ridingHref.plan : guestRidingHref.plan}
    >
      <SiteIcon name="plan" />
      Запланировать покатушку
    </Link>
  );
}
