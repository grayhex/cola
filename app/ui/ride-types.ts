import type { Passport, Range } from "../../lib/ride-match-core.ts";
import type { JsonData, AccountBikeDto } from "../../lib/contracts.ts";
import type {
  rideSettings,
  previewRide,
  respondRide,
  saveRide,
  planRide,
  importGarmin,
} from "../../lib/rides.ts";
import type {
  activityStatus,
  beginActivityOAuth,
} from "../../lib/activity-sync.ts";
import type { parseGarminCsv } from "../../lib/garmin-csv.ts";
import type {
  listIntents,
  intentDetail,
  intentPreferences,
} from "../../lib/ride-intents.ts";
import type {
  matchRides,
  planInterest,
  inviteFromInterest,
  interestGroups,
  draftInterest,
} from "../../lib/ride-matching.ts";
import type { permittedAnalysis } from "../../lib/ride-analysis.ts";
import type { RideCardDto } from "./content-types.ts";

export type RideItem = RideCardDto;
export type RideConfig = Awaited<ReturnType<typeof rideSettings>>;
export type RidePreview = JsonData<Awaited<ReturnType<typeof previewRide>>>;
export type RideResponse = JsonData<Awaited<ReturnType<typeof respondRide>>>;
export type RideSaved = JsonData<Awaited<ReturnType<typeof saveRide>>>;
export type PlanSaved = JsonData<Awaited<ReturnType<typeof planRide>>>;
export type RideSaveHandler = (
  result: "planned" | "saved" | "removed",
  created?: CreatedPlan,
) => void | Promise<void>;
export type GarageDto = { bikes: AccountBikeDto[] };
export type ActivityDto = JsonData<Awaited<ReturnType<typeof activityStatus>>>;
export type ActivityOAuthDto = Awaited<ReturnType<typeof beginActivityOAuth>>;
export type GarminPreviewDto = ReturnType<typeof parseGarminCsv>;
export type GarminImportDto = Awaited<ReturnType<typeof importGarmin>>;
export type IntentListDto = JsonData<Awaited<ReturnType<typeof listIntents>>>;
export type IntentDto = JsonData<Awaited<ReturnType<typeof intentDetail>>>;
export type IntentPreferencesDto = JsonData<
  Awaited<ReturnType<typeof intentPreferences>>
>;
export type RideMatchesDto = JsonData<Awaited<ReturnType<typeof matchRides>>>;
export type PlanInterestDto = JsonData<
  Awaited<ReturnType<typeof planInterest>>
>;
export type InterestInvitationsDto = JsonData<
  Awaited<ReturnType<typeof inviteFromInterest>>
>;
export type InterestGroupsDto = JsonData<
  Awaited<ReturnType<typeof interestGroups>>
>;
export type DraftInterestDto = JsonData<
  Awaited<ReturnType<typeof draftInterest>>
>;
export type RideAnalysisSeries = NonNullable<
  ReturnType<typeof permittedAnalysis>
>;

export type CreatedPlan = PlanSaved & {
  occurrenceAt: string;
  // The plan came from a group of interest: invitations are offered next.
  fromInterest?: boolean;
};
export type PlanDraft = {
  startAt?: string;
  passport?: PassportDraft;
  fromInterest?: boolean;
};
export type PassportRangeKey =
  "distanceKm" | "durationMinutes" | "groupSize" | "speedKmh";
export type PassportChoiceKey =
  "purpose" | "pace" | "surface" | "difficulty" | "regroupPolicy";
export type PassportDraft = Omit<Passport, PassportRangeKey> &
  Partial<Record<PassportRangeKey, Partial<Range>>>;
export type IntentWindowDraft = {
  startLocal: string;
  endLocal: string;
  startFold?: string;
  endFold?: string;
};
export type IntentDraft = {
  id?: string;
  requestId?: string;
  readiness: string;
  timeZone: string;
  windows: IntentWindowDraft[];
  passport: PassportDraft;
  meetNewPeople?: boolean;
  visibility: string;
  allowSuggestions?: boolean;
};
export type PreferencesDraft = {
  passport: PassportDraft;
  meetNewPeople?: boolean;
};
