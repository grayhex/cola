"use client";
import { useSite } from "./site-provider.tsx";
import { ReportButton } from "./community-controls.tsx";
import type { ClubDto } from "../../lib/club-contracts.ts";
export default function ClubReport({ club }: { club: ClubDto }) {
  const { viewer } = useSite();
  return club.membership?.userId === viewer?.id &&
    club.membership?.role === "owner" ? null : (
    <ReportButton user={viewer} entityType="club" targetId={club.id} />
  );
}
