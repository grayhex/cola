import type { discoverySearch } from "./discovery.ts";
import type { BikeRow } from "./database-rows.ts";
import type { listAssetLibrary } from "./site-asset-library.ts";
import type { participationSummary } from "./participation.ts";
import type { componentCatalog } from "./component-catalog.ts";
import type { bikeCatalog } from "./bike-catalog.ts";
import type { componentGallery } from "./component-photos.ts";
import type { modelLanding, partLanding } from "./experience-landing.ts";
import type { searchExperience } from "./search.ts";
import type { reportPage } from "./reports.ts";
import type { adminLegalDocuments } from "./legal-documents.ts";
import type { adminMobileSettings } from "./mobile-settings.ts";
import type { getGameSettings } from "./gamification.ts";
import type { GameRule } from "./game-rules.ts";
import type { Settings as ResolverSettings } from "../services/bike-resolver/src/settings.ts";
import type { Diagnostics } from "../services/bike-resolver/src/planner.ts";
import type { listSessions } from "./account-data.ts";
import type { legalMetadata } from "./legal-documents.ts";
import type { followPage } from "./follows.ts";
import type { decorateBike } from "./showcase.ts";
import type { accountOverview } from "./profiles.ts";
import type { profileInput } from "./social-validation.ts";
import type { settingsInput as settingsInputType } from "./admin-validation.ts";
import type { catalogInput as catalogInputType } from "./admin-validation.ts";
// Type-only boundaries shared by native TS producers and consumers. Keep runtime
// schemas/DTO mappers authoritative; these types do not validate external data.
import type { z } from "zod";
import type { bikeInput, componentInput, credentials } from "./validation.ts";
import type { classificationInput } from "./classification-validation.ts";
import type { commentInput, reportInput } from "./community-validation.ts";
export type UserPreferences = z.infer<typeof profileInput>["preferences"];
export type SiteSettings = z.infer<typeof settingsInputType>;
export type SiteCatalog = z.infer<typeof catalogInputType>;
export interface SiteDefinition {
  settings: SiteSettings;
  catalog: SiteCatalog;
  settingsVersion: number;
  catalogVersion: number;
}

// UUIDs remain strings until checked by a runtime schema. No branded casts.
export type EntityId = string;
export type PublicReference =
  | { legacyId: EntityId; publicId?: never }
  | { publicId: string; legacyId?: never };

export interface PublicEntityReference {
  id: EntityId;
  share_id: string;
  public_id: string;
  slug: string;
}

// Authenticated server snapshot. Public author DTOs omit its private fields.
export interface CurrentUser {
  id: EntityId;
  email: string;
  name: string;
  role: "user" | "admin";
  preferences: UserPreferences;
  username: string;
  bio: string;
  location: string;
  created_at: Date;
  avatar_id: EntityId | null;
  email_verified_at: Date | null;
}
export type Viewer = CurrentUser | null;
export type ViewerDto = Omit<
  CurrentUser,
  "created_at" | "email_verified_at"
> & {
  created_at: string;
  email_verified_at: string | null;
};
export interface MeResponse {
  user: ViewerDto | null;
}

export interface PublicAuthor {
  id: EntityId;
  username: string;
  name: string;
  avatar: string | null;
}
export interface AuthorRow {
  id: EntityId;
  username: string;
  name: string;
  avatar_id?: EntityId | null;
}
export interface Relationship {
  isSelf: boolean;
  following: boolean;
  followedBy: boolean;
  friends: boolean;
}
export interface PublicProfile extends PublicAuthor {
  bio: string;
  location: string;
  createdAt: Date | string;
  counts: {
    bikes: number;
    followers: number;
    following: number;
    friends: number;
  };
  relationship: Relationship;
  badges: unknown[];
}

// Matches existing error and paginated-list payloads; no API envelope change.
export interface ApiError {
  error: string;
  code?: string;
}
export interface Pagination {
  total: number;
  page: number;
  pageSize: number;
}
export interface Page<T> extends Pagination {
  items: T[];
}

export type Credentials = z.infer<typeof credentials>;
export type BikeInput = z.infer<typeof bikeInput>;
export type ComponentInput = z.infer<typeof componentInput>;
export type Classification = z.infer<typeof classificationInput>;
export type CommentInput = z.infer<typeof commentInput>;
export type ReportInput = z.infer<typeof reportInput>;

export interface PublicPhoto {
  id: EntityId;
  is_cover: boolean;
  source_page_url: string | null;
  /**
   * Owner only (#370): the photo was cleared of its backdrop and the file it
   * was made of is kept. The public view never carries it.
   */
  has_original?: boolean;
}
/**
 * A try at taking the backdrop off a photo (#370). Only its owner may fetch the
 * picture, for an hour; nothing of the server's files is named.
 */
export interface PhotoPreview {
  id: EntityId;
  /** The picture without its backdrop (WebP with transparency). */
  url: string;
  /** The picture as it was, for a found photo, which the page holds only as a thumbnail. */
  beforeUrl: string | null;
  width: number;
  height: number;
  /** The share of the picture that became see-through (0…1). */
  removed: number;
  bytes: number;
}
// PostgreSQL numeric columns remain strings at the existing DTO boundary.
export interface PublicComponent {
  id: EntityId;
  section: "build" | "accessories";
  model_id: EntityId | null;
  category: string;
  name: string;
  notes: string;
  url: string;
  group_id: string;
  sort_order: number;
  price?: string | null;
}
export interface PublicBike extends PublicEntityReference {
  catalog_model_id: EntityId | null;
  name: string;
  brand: string;
  model: string;
  trim: string;
  year: number;
  category: string;
  classification: Classification;
  purposes: string[];
  description: string;
  color: string;
  size: string;
  weight: string | null;
  mileage: number;
  manufacturer_url: string;
  is_public: boolean;
  is_former: boolean;
  group_order: string[];
  show_bike_price: boolean;
  show_component_prices: boolean;
  show_accessory_prices: boolean;
  price?: string | null;
  components: PublicComponent[];
  photos: PublicPhoto[];
}
export interface SocialBike extends PublicBike {
  author: PublicAuthor | null;
  is_owner: boolean;
  likes: number;
  liked: boolean;
  comments: number;
  scores: { completeness: number; upgrade: number };
}

export type JsonData<T> = T extends Date
  ? string
  : T extends object
    ? { [K in keyof T]: JsonData<T[K]> }
    : T;

// JSON responses consumed by the migrated core UI. Derive domain data from
// the server producers; dates cross HTTP as strings.
export type AccountOverviewDto = JsonData<
  Awaited<ReturnType<typeof accountOverview>>
>;
export type AccountBikeDto = JsonData<Awaited<ReturnType<typeof decorateBike>>>;
// Owner-only fields are absent from the public allowlist. Shared controls may
// read them only on an owner snapshot; adding optional types changes no DTO.
export type BikeDto = AccountBikeDto &
  Partial<
    Pick<
      JsonData<BikeRow>,
      "factory_spec" | "owner_id" | "created_at" | "updated_at"
    >
  >;
export type AssetLibraryDto = JsonData<
  Awaited<ReturnType<typeof listAssetLibrary>>
>;
export type ParticipationDto = Awaited<ReturnType<typeof participationSummary>>;
export type ComponentCatalogDto = JsonData<
  Awaited<ReturnType<typeof componentCatalog>>
>;
export type BikeCatalogDto = JsonData<Awaited<ReturnType<typeof bikeCatalog>>>;
export type ComponentGalleryDto = JsonData<
  Awaited<ReturnType<typeof componentGallery>>
>;
export type ModelLandingDto = NonNullable<
  Awaited<ReturnType<typeof modelLanding>>
>;
export type PartLandingDto = NonNullable<
  Awaited<ReturnType<typeof partLanding>>
>;
export type ExperienceLandingDto = ModelLandingDto | PartLandingDto;
export type ExperienceSearchDto = JsonData<
  Awaited<ReturnType<typeof searchExperience>>
>;
export type ReportPageDto = JsonData<Awaited<ReturnType<typeof reportPage>>>;
export interface ManagedUser {
  id: string;
  email: string;
  name: string;
  role: "user" | "admin";
  blocked: boolean;
  created_at: string;
  bikes: number;
}
export interface AdminAuditEvent {
  id: string;
  action: string;
  target: string;
  created_at: string;
  actor: string | null;
}
export interface AdminOverviewDto extends SiteDefinition {
  user: ViewerDto;
  stats: { users: number; bikes: number; photos: number };
  participation: ParticipationDto;
}
export type AdminLegalDto = JsonData<
  Awaited<ReturnType<typeof adminLegalDocuments>>
>;
// The native app settings editor (#338): stored value, version and the public
// answer apps receive now.
export type AdminMobileDto = JsonData<
  Awaited<ReturnType<typeof adminMobileSettings>>
>;
export type GameSettingsDto = Awaited<ReturnType<typeof getGameSettings>>;
export type GameRuleDto = GameRule & { awarded: number };
export interface GameRulesDto {
  settings: GameSettingsDto;
  rules: GameRuleDto[];
}
export interface AdminGameBike {
  id: string;
  name: string;
  share_id: string;
  leaderboard_excluded: boolean;
}
export interface BikePhotoCandidate {
  id: string;
  sourceUrl: string;
}
export interface ResolverBrand {
  id: string;
  name: string;
  // "direct": an adapter reads the official site; "distributor": the official
  // shop of the brand's importer. Any other brand is searched through the
  // stores only.
  kind?: "direct" | "distributor";
  enabled: boolean;
  adapterVersion: number;
  limitation: string | null;
}
export interface ResolverStore {
  id: string;
  name: string;
  enabled: boolean;
  storeVersion: number;
  // Whether the store's own catalogue is searched; otherwise only its pages are read.
  search: boolean;
  domains: string[];
  limitation: string | null;
}
export interface ResolverBrandsDto {
  brands: ResolverBrand[];
  stores?: ResolverStore[];
  autoResolve: boolean;
  storeSearch?: boolean;
}
export interface ResolverSettingsDto {
  value: ResolverSettings;
  version: number;
  brands: ResolverBrand[];
  stores?: ResolverStore[];
}
export interface ResolverDiagnosticsDto {
  extractorVersion: number;
  sources: ReturnType<Diagnostics["snapshot"]>;
}
export type FollowPageDto = JsonData<
  NonNullable<Awaited<ReturnType<typeof followPage>>>
>;
export type LegalMetadataDto = Awaited<ReturnType<typeof legalMetadata>>;
export type SessionsDto = JsonData<Awaited<ReturnType<typeof listSessions>>>;
export type DiscoverySearchDto = JsonData<
  Awaited<ReturnType<typeof discoverySearch>>
>;
export interface EmailVerificationResponse {
  ok: true;
  verified?: boolean;
  sent?: boolean;
}
export interface UnreadCountResponse {
  unread: number;
}
