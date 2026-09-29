"use client";
import Link from "next/link";
import SiteIcon from "./site-icon.jsx";

// Discovery offers planning only; imports live under «Интеграции и импорт».
export default function RideCreationActions() {
  return (
    <Link className="button" href="/account?tab=rides&action=plan">
      <SiteIcon name="plan" />
      Запланировать покатушку
    </Link>
  );
}
