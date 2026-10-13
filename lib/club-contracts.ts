import type { JSONContent } from "@tiptap/core";
export type ClubRole = "owner" | "admin" | "organizer" | "member";
export type ClubState =
  "pending" | "invited" | "active" | "left" | "excluded" | "blocked";
export interface ClubDto {
  id: string;
  name: string;
  slogan: string;
  city: string;
  formats: string[];
  mission: string;
  missionDoc: JSONContent;
  rules: string;
  rulesDoc: JSONContent;
  rulesUpdatedAt: string | null;
  joinMode: "application" | "open";
  membersVisibility: "public" | "members";
  logo: string | null;
  cover: string | null;
  archived: boolean;
  version: number;
  memberCount: number;
  membership: {
    userId: string;
    state: ClubState;
    role: ClubRole;
    inviteExpiresAt: string | null;
  } | null;
  canManage: boolean;
  ownershipOffer: { expiresAt: string } | null;
}
export interface ClubEligibility {
  verified: boolean;
  hasBike: boolean;
  owned: number;
  canCreate: boolean;
}
export interface ClubForm {
  name: string;
  slogan: string;
  city: string;
  formatsText: string;
  mission: string;
  joinMode: "application" | "open";
  membersVisibility: "public" | "members";
}

export type ClubSummaryDto = Omit<
  ClubDto,
  "mission" | "missionDoc" | "rules" | "rulesDoc" | "rulesUpdatedAt" | "version"
>;
export interface ClubBadgeDto {
  id: string;
  name: string;
  logo: string | null;
  href: string;
}
export interface ClubBadgesDto {
  items: ClubBadgeDto[];
  total: number;
}
