import type { settingsInput as settingsInputType } from "./admin-validation.ts";
import type { catalogInput as catalogInputType } from "./admin-validation.ts";
// Type-only boundaries shared by native TS and legacy JSDoc. Keep runtime
// schemas/DTO mappers authoritative; these types do not validate external data.
import type { z } from "zod";
import type { bikeInput, componentInput, credentials } from "./validation.ts";
import type { classificationInput } from "./classification-validation.ts";
import type { commentInput, reportInput } from "./community-validation.ts";
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
  preferences: Record<string, unknown>;
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
