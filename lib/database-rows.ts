import type * as RideSpeedTypes from "./ride-speed.ts";
import type * as RideMetricsTypes from "./ride-metrics.ts";
import type { Passport } from "./ride-match-core.ts";
import type { Part } from "../services/bike-resolver/src/component-identity.ts";
// PostgreSQL rows at repository boundaries. Numeric/bigint values remain strings;
// nullable database columns stay nullable. JSON fields use their domain contract.
import type { z } from "zod";
import type { Classification, PublicComponent } from "./contracts.ts";
import type { Resolved } from "../services/bike-resolver/src/domain.ts";
import type { componentPhotoSource } from "./component-photo-search.ts";
export interface FactorySnapshot {
  section: "build" | "accessories";
  category: string;
  name: string;
  notes: string;
  price: number | null;
  url: string;
  group_id: string;
}
export interface FactoryOrigin {
  id: string;
  source: Part;
  snapshot: FactorySnapshot;
}
export type FactorySpec = Resolved & {
  colaImport?: { version: number; parts: FactoryOrigin[] };
};

export interface BikeRow {
  id: string;
  owner_id: string;
  name: string;
  brand: string;
  model: string;
  year: number;
  category: string;
  description: string;
  color: string;
  size: string;
  weight: string | null;
  is_public: boolean;
  share_id: string;
  created_at: Date;
  updated_at: Date;
  trim: string;
  factory_spec: FactorySpec | null;
  manufacturer_url: string;
  price: string | null;
  show_bike_price: boolean;
  show_component_prices: boolean;
  show_accessory_prices: boolean;
  group_order: string[];
  mileage: number;
  published_at: Date | null;
  leaderboard_excluded: boolean;
  purposes: string[];
  classification: Classification | null;
  is_former: boolean;
  public_id: string;
  slug: string;
  catalog_model_id: string | null;
}

export interface ComponentRow {
  id: string;
  bike_id: string;
  section: "build" | "accessories";
  category: string;
  name: string;
  notes: string;
  price: string | null;
  created_at: Date;
  url: string;
  group_id: string;
  sort_order: number;
  model_id: string | null;
  position: string;
}

export interface BikeModelRow {
  id: string;
  brand: string;
  name: string;
  brand_slug: string;
  slug: string;
  first_public_at: Date | null;
  archived: boolean;
  merged_into: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

export interface ComponentModelRow {
  id: string;
  category: string;
  brand: string;
  name: string;
  category_slug: string;
  slug: string;
  first_public_at: Date | null;
  archived: boolean;
  merged_into: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
  cover_photo_id: string | null;
  gallery_version: number;
  description: string;
}

export interface ComponentPhotoRow {
  id: string;
  model_id: string;
  author_id: string;
  filename: string;
  size_bytes: number;
  width: number;
  height: number;
  caption: string;
  sort_order: number;
  hidden: boolean;
  version: number;
  created_at: Date;
  updated_at: Date;
  source: z.infer<typeof componentPhotoSource> | null;
}

export interface GameRuleRow {
  key: string;
  kind: "award" | "record";
  subject: "bike" | "ride" | "user";
  metric: string;
  comparison: "gte" | "lte";
  threshold: string | null;
  direction: "max" | "min" | null;
  category: string | null;
  min_distance_km: string | null;
  keywords: string[];
  name: string;
  description: string;
  image_id: string | null;
  enabled: boolean;
  builtin: boolean;
  position: number;
  created_at: Date;
  updated_at: Date;
}

/** A file of the site media library; the browser reads it at /api/assets/<id>. */
export interface SiteAssetRow {
  id: string;
  name: string;
  filename: string;
  created_at: Date;
}

/**
 * The single row of the native app settings (#338). `value` is what the admin
 * edits and is parsed on every read; each revision is the settings version
 * that last changed its block.
 */
export interface MobileSettingsRow {
  id: number;
  value: unknown;
  version: number;
  onboarding_revision: number;
  notice_revision: number;
  updated_at: Date;
}

export interface JournalRow {
  id: string;
  share_id: string;
  owner_id: string;
  bike_id: string | null;
  kind: "build" | "service" | "review" | "question" | "story" | "article";
  title: string;
  body: string;
  status: "draft" | "published";
  is_public: boolean;
  event_date: Date | null;
  mileage: number | null;
  ride_id: string | null;
  components: (PublicComponent & { capturedAt: string })[];
  created_at: Date;
  updated_at: Date;
  published_at: Date | null;
  installation_result: string | null;
  solution_id: string | null;
  participation_recorded: boolean;
  topic_id: string | null;
  public_id: string;
  slug: string;
}

export interface MarketRow {
  id: string;
  share_id: string;
  owner_id: string;
  title: string;
  description: string;
  category: "bikes" | "components" | "accessories";
  condition: "new" | "used";
  price: string | null;
  currency: string;
  location: string;
  contact: string;
  status: "draft" | "active" | "sold";
  created_at: Date;
  updated_at: Date;
  published_at: Date | null;
  listing_type: string;
  public_id: string;
  slug: string;
  expires_at: Date | null;
  expiry_notice_for: Date | null;
  component_model_id: string | null;
  bike_model_id: string | null;
  linked_bike_id: string | null;
}

export interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string | null;
  created_at: Date;
  role: "user" | "admin";
  blocked: boolean;
  preferences: Record<string, unknown>;
  username: string;
  bio: string;
  location: string;
  avatar_id: string | null;
  avatar_size_bytes: string;
  email_verified_at: Date | null;
  password_changed_at: Date | null;
  public_id: string;
  slug: string;
}

export interface PhotoRow {
  id: string;
  bike_id: string;
  filename: string;
  is_cover: boolean;
  created_at: Date;
  source_url: string | null;
  source_page_url: string | null;
  size_bytes: string | null;
}

export interface SessionRow {
  token_hash: string;
  user_id: string;
  expires_at: Date;
  id: string;
  created_at: Date;
  last_seen_at: Date;
  user_agent: string;
}

export interface AuthTokenRow {
  token_hash: string;
  user_id: string;
  purpose: "password_reset" | "email_verify" | "email_change";
  email: string | null;
  created_at: Date;
  expires_at: Date;
  used_at: Date | null;
}

export interface ChatJobRow {
  user_id: string;
  kind: "upsert" | "delete";
  revoke_before: Date | null;
  task_id: string | null;
  attempts: number;
  next_attempt_at: Date;
  updated_at: Date;
}

// Shared with the legacy ride loaders during the backend migration.
export interface RideRow {
  id: string;
  share_id: string;
  owner_id: string;
  bike_id: string;
  title: string;
  description: string;
  started_at: Date | null;
  ended_at: Date | null;
  distance_m: number;
  elapsed_time_s: number | null;
  moving_time_s: number | null;
  avg_speed_mps: string | null;
  elevation_gain_m: string | null;
  point_count: number;
  public_point_count: number;
  public_geometry: number[][][];
  is_public: boolean;
  published_at: Date | null;
  privacy_enabled: boolean;
  privacy_radius_m: number;
  source_hash: string;
  created_at: Date;
  updated_at: Date;
  public_speed_profile: RideSpeedTypes.SpeedPoint[][];
  status: string;
  source_kind: string;
  has_track: boolean;
  gpx_hash: string | null;
  import_metrics: RideMetricsTypes.RideMetrics;
  visible_metrics: string[] | null;
  features: string[];
  meeting_point: string;
  recurrence: string;
  recurrence_timezone: string;
  public_id: string;
  slug: string;
  track_file_id: string | null;
  plan_passport: Passport;
  meeting_visibility: string;
  plan_ends_at: Date | null;
  proposed_from_interest: boolean;
  agreement_revision: number;
  agreement_changes: string[];
  agreement_changed_at: Date | null;
  recruitment_closed_for: Date | null;
}
export interface RideViewRow extends RideRow {
  occurs_at: Date | null;
  viewer_active: boolean;
  invited: boolean;
  rsvp: "accepted" | "maybe" | "declined" | null;
  rsvp_revision: number | null;
  recruitment_closed: boolean;
  rsvp_counts: Record<string, number> | null;
  bike_name: string;
  bike_share_id: string;
  bike_public: boolean;
  username: string;
  author_name: string;
  avatar_id: string | null;
  likes: number;
  liked: boolean;
  comments: number;
  answered_occurrence?: Date | null;
  occurrence_cancelled?: boolean;
}

// Tables of ride intentions and answers (migrations 018, 037, 040). Rows as the
// services read them and as the test builders in tests/support write them.
export interface RideIntentRow {
  id: string;
  owner_id: string;
  readiness: "ready" | "considering";
  time_zone: string;
  passport: Passport;
  meet_new_people: boolean | null;
  visibility: "private" | "community";
  allow_suggestions: boolean;
  status: "active" | "cancelled" | "deleted";
  request_hash: string;
  created_at: Date;
  updated_at: Date;
}
export interface RideIntentWindowRow {
  intent_id: string;
  starts_at: Date;
  ends_at: Date;
}
export interface RideRsvpRow {
  ride_id: string;
  user_id: string;
  occurs_at: Date;
  response: "accepted" | "declined" | "maybe";
  updated_at: Date;
  revision: number;
}
export interface RideInvitationRow {
  ride_id: string;
  user_id: string;
  response: "pending" | "accepted" | "declined";
  created_at: Date;
  source: "direct" | "interest";
}

// Notices and comments as stored (the notice list read by the viewer is
// NotificationRow in notifications.ts: the joined view, not this table).
export interface NotificationRecord {
  id: string;
  recipient_id: string;
  actor_id: string | null;
  type: string;
  bike_id: string | null;
  comment_id: string | null;
  dedup_key: string;
  /** The group of a discussion notice: one author, one object, a quarter of an hour. */
  group_key: string | null;
  created_at: Date;
  read_at: Date | null;
  ride_id: string | null;
  ride_comment_id: string | null;
  entry_id: string | null;
  entry_comment_id: string | null;
  listing_id: string | null;
  component_id: string | null;
  component_comment_id: string | null;
  event_occurs_at: Date | null;
  event_revision: number | null;
  deliver_after: Date;
  released_at: Date | null;
  cancelled_at: Date | null;
}
export interface BikeCommentRow {
  id: string;
  bike_id: string;
  author_id: string | null;
  parent_id: string | null;
  body: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}
