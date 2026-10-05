import type { CurrentUser, PublicAuthor, SocialBike } from "../contracts.ts";
import type { visibleBikeById } from "../showcase.ts";
import type { listSessions } from "../account-data.ts";
import type { CommentRow } from "../comments.ts";
import type { JournalViewRow } from "../journal.ts";
import type { ComponentPhotoRow, RideViewRow } from "../database-rows.ts";
import type { CatalogRow } from "../component-catalog.ts";
import { partLandingPath } from "../experience-catalog.ts";
import type {
  AnalysisPoint,
  AnalysisChannel,
} from "../ride-analysis-contract.ts";
import { bounds } from "../ride-geometry.ts";
import type { marketApiCard } from "../market.ts";
import type { FeedEntry } from "../ride-feed.ts";
import type { notificationCard } from "../notifications.ts";
import type { NotificationSettings } from "../notification-settings.ts";
import type { PushDevice } from "../push-devices.ts";
import { meetingVisible, shownMetrics } from "../rides.ts";
import type {
  myUpcomingEntries,
  RideParticipation as ParticipationState,
} from "../rides.ts";
import type { intentDetail } from "../ride-intents.ts";
import type { NearbyOffersState, NearbyState } from "../nearby.ts";
import { plannedEnd } from "../ride-plan.ts";
import { richExcerpt } from "../rich-text.ts";
import type { TokenGrant } from "../device-sessions.ts";
import type {
  AccountSession,
  Bike,
  BikeSummary,
  Comment,
  ComponentModel,
  FeedItem,
  ComponentPhoto,
  JournalEntry,
  JournalSummary,
  MarketListing,
  MarketListingDetail,
  Me,
  MyUpcomingRide,
  Nearby,
  NearbyOffers,
  Notification,
  NotificationSettingsBody,
  NotificationTarget,
  OwnRideSummary,
  Profile,
  PushDeviceBody,
  Relationship,
  Ride,
  RideAnalysis,
  RideIntent,
  RideParticipation,
  RideSummary,
  SessionGrant,
  UserSummary,
} from "./schemas.ts";
import type { ClassificationSource } from "../bike-classification.ts";
import { classificationOf } from "../bike-classification.ts";

// Domain objects -> the /api/v1 contract (#134). Every field is picked by
// name: nothing is spread from a row, so a column added to the database or to
// a legacy DTO can never reach a client by accident. schemas.ts says what the
// result must look like; the tests parse real responses with it.

/** PostgreSQL numeric values travel as strings; the contract uses numbers. */
function amount(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

const iso = (value: Date) => value.toISOString();

export function toMe(user: CurrentUser): Me {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    email: user.email,
    role: user.role,
    bio: user.bio,
    location: user.location,
    avatarUrl: user.avatar_id ? "/api/avatars/" + user.avatar_id : null,
    createdAt: iso(user.created_at),
    emailVerifiedAt: user.email_verified_at
      ? iso(user.email_verified_at)
      : null,
  };
}

type SessionRow = Awaited<ReturnType<typeof listSessions>>[number];

export function toAccountSession(session: SessionRow): AccountSession {
  return {
    id: session.id,
    kind: session.kind,
    deviceName: session.deviceName,
    platform: session.platform,
    appVersion: session.appVersion,
    userAgent: session.userAgent,
    createdAt: iso(session.createdAt),
    lastSeenAt: iso(session.lastSeenAt),
    current: session.current === true,
  };
}

export function toSessionGrant(
  grant: TokenGrant,
  session: SessionRow,
  user: CurrentUser,
): SessionGrant {
  return {
    session: toAccountSession({ ...session, current: true }),
    accessToken: grant.accessToken,
    accessTokenExpiresAt: iso(grant.accessTokenExpiresAt),
    refreshToken: grant.refreshToken,
    refreshTokenExpiresAt: iso(grant.refreshTokenExpiresAt),
    user: toMe(user),
  };
}

interface PhotoSource {
  id: string;
  is_cover: boolean;
  source_page_url: string | null;
}
export const toPhoto = (photo: PhotoSource) => ({
  id: photo.id,
  isCover: photo.is_cover,
  url: "/api/photos/" + photo.id,
  sourcePageUrl: photo.source_page_url,
});

const toAuthor = (author: PublicAuthor | null) =>
  author
    ? {
        id: author.id,
        username: author.username,
        name: author.name,
        avatarUrl: author.avatar,
      }
    : null;

// What a card needs from either view of a bike (public or the owner's own).
interface SummarySource {
  id: string;
  name: string;
  brand: string;
  model: string;
  trim: string;
  year: number;
  category: string;
  classification?: ClassificationSource["classification"];
  purposes: string[];
  is_former: boolean;
  is_public: boolean;
  is_owner: boolean;
  photos: PhotoSource[];
  author: PublicAuthor | null;
  likes: number;
  liked: boolean;
  comments: number;
  scores: { completeness: number; upgrade: number };
}

function toSummary(bike: SummarySource): BikeSummary {
  const classification = classificationOf(bike);
  return {
    id: bike.id,
    name: bike.name,
    brand: bike.brand,
    model: bike.model,
    trim: bike.trim,
    year: bike.year,
    category: bike.category,
    classification: {
      category: classification.category,
      subtype: classification.subtype ?? null,
      suspension: classification.suspension ?? null,
      construction: classification.construction ?? null,
      uses: [...classification.uses],
      electric: classification.electric,
      fatbike: classification.fatbike,
    },
    isFormer: bike.is_former === true,
    isPublic: bike.is_public,
    isOwner: bike.is_owner,
    // Photos arrive cover first, so the first one is the cover or the next best.
    coverPhoto: bike.photos[0] ? toPhoto(bike.photos[0]) : null,
    photoCount: bike.photos.length,
    author: toAuthor(bike.author),
    likes: bike.likes,
    liked: bike.liked,
    comments: bike.comments,
    scores: {
      completeness: bike.scores.completeness,
      upgrade: bike.scores.upgrade,
    },
  };
}

/** A list item: a card built from the public view of a bike. */
export function toBikeSummary(bike: SocialBike): BikeSummary {
  return toSummary(bike);
}

/**
 * The visible bike read by id: the public view for everyone but its owner,
 * the owner's own view for the owner. Prices follow the owner's settings for
 * everyone else; the owner sees their own prices and the settings.
 */
export type BikeSource = NonNullable<
  Awaited<ReturnType<typeof visibleBikeById>>
>;

export function toBike(bike: BikeSource): Bike {
  return {
    ...toSummary(bike),
    description: bike.description,
    color: bike.color,
    size: bike.size,
    weight: amount(bike.weight),
    mileage: bike.mileage,
    manufacturerUrl: bike.manufacturer_url,
    purposes: [...bike.purposes],
    groupOrder: [...bike.group_order],
    price: amount(bike.price),
    priceVisibility: bike.is_owner
      ? {
          bike: bike.show_bike_price,
          components: bike.show_component_prices,
          accessories: bike.show_accessory_prices,
        }
      : null,
    components: bike.components.map(toBikeComponent),
    photos: bike.photos.map(toPhoto),
  };
}

interface ComponentSource {
  id: string;
  model_id: string | null;
  section: "build" | "accessories";
  category: string;
  name: string;
  notes: string;
  url: string;
  group_id: string;
  sort_order: number;
  price?: string | number | null;
}

/** A part of a bicycle as the API shows it (the price is already the viewer's). */
export function toBikeComponent(part: ComponentSource) {
  return {
    id: part.id,
    modelId: part.model_id,
    section: part.section,
    category: part.category,
    name: part.name,
    notes: part.notes,
    url: part.url,
    groupId: part.group_id,
    sortOrder: part.sort_order,
    price: amount(part.price),
  };
}

// People (#300). The relationship is the viewer's, so a guest gets null, and a
// row is turned into a DTO field by field like everything else here.
interface PersonRow {
  id: string;
  username: string;
  name: string;
  avatar_id: string | null;
  is_self: boolean;
  is_following: boolean;
  followed_by: boolean;
}

export function toRelationship(
  row: Pick<PersonRow, "is_self" | "is_following" | "followed_by">,
): Relationship {
  return {
    isSelf: row.is_self,
    following: row.is_following,
    followedBy: row.followed_by,
    friends: row.is_following && row.followed_by,
  };
}

const avatarUrl = (avatarId: string | null) =>
  avatarId ? "/api/avatars/" + avatarId : null;

export function toUserSummary(row: PersonRow, signedIn: boolean): UserSummary {
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    avatarUrl: avatarUrl(row.avatar_id),
    relationship: signedIn ? toRelationship(row) : null,
  };
}

export function toProfile(
  row: PersonRow & { bio: string; location: string; created_at: Date },
  counts: { bikes: string; followers: string; following: string },
  signedIn: boolean,
): Profile {
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    avatarUrl: avatarUrl(row.avatar_id),
    bio: row.bio,
    location: row.location,
    createdAt: iso(row.created_at),
    counts: {
      bikes: Number(counts.bikes),
      followers: Number(counts.followers),
      following: Number(counts.following),
    },
    relationship: signedIn ? toRelationship(row) : null,
  };
}

// Journal and comments (#301). Fields are picked by name, so a column added to
// a table or to a legacy DTO never reaches a client on its own.
const author = (row: {
  owner_id: string;
  username: string;
  author_name: string;
  avatar_id: string | null;
}) => ({
  id: row.owner_id,
  username: row.username,
  name: row.author_name,
  avatarUrl: avatarUrl(row.avatar_id),
});

const dateOnly = (value: string | Date | null) =>
  value === null
    ? null
    : (value instanceof Date ? value.toISOString() : value).slice(0, 10);

function toEntrySummary(row: JournalViewRow, viewer: string | null) {
  return {
    id: row.id,
    kind: row.kind as JournalSummary["kind"],
    title: row.title,
    status: row.status,
    isPublic: row.is_public,
    eventDate: dateOnly(row.event_date),
    mileage: row.mileage,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    bike: { id: row.bike_id as string, name: row.bike_name },
    author: author(row),
    likes: row.likes,
    comments: row.comments,
    liked: viewer !== null && !!row.liked,
  };
}

const instantOf = (value: Date | string | null | undefined) =>
  value == null ? null : new Date(value).toISOString();
const numberOrNull = (value: string | number | null | undefined) =>
  value == null ? null : Number(value);

/** The cards of the lists: what a ride is, who rode it and the counters. */
export function toRideSummary(
  row: RideViewRow,
  viewer: string | null,
): RideSummary {
  void viewer;
  const planned = row.status === "planned";
  const counts = row.rsvp_counts ?? {};
  return {
    id: row.id,
    title: row.title,
    status: planned ? "planned" : "completed",
    kind: row.source_kind === "planned" ? "planned" : "recorded",
    startedAt: planned ? null : instantOf(row.started_at),
    scheduledAt: planned ? instantOf(row.occurs_at ?? row.started_at) : null,
    recurrence: row.recurrence === "weekly" ? "weekly" : "none",
    hasTrack: row.has_track,
    metrics: {
      // A plan without a track has no distance; the column only holds a zero.
      distanceM:
        row.source_kind === "planned" && !row.has_track ? null : row.distance_m,
      elapsedTimeS: row.elapsed_time_s,
      movingTimeS: row.moving_time_s,
      avgSpeedMps: numberOrNull(row.avg_speed_mps),
      elevationGainM: numberOrNull(row.elevation_gain_m),
    },
    bike: { id: row.bike_id, name: row.bike_name },
    author: author(row),
    likes: row.likes,
    comments: row.comments,
    liked: row.liked,
    // Counts only; who answered is never part of the public contract.
    participants: planned
      ? { going: counts.accepted ?? 0, maybe: counts.maybe ?? 0 }
      : null,
  };
}

/**
 * The owner's list card: the public summary plus the owner's own fields. A plan
 * that was called off is still a plan (its date, its counters); the status says
 * so.
 */
export function toOwnRideSummary(
  row: RideViewRow,
  viewer: string | null,
): OwnRideSummary {
  const cancelledPlan =
    row.status === "cancelled" && row.source_kind === "planned";
  return {
    ...toRideSummary(
      cancelledPlan ? { ...row, status: "planned" } : row,
      viewer,
    ),
    status:
      row.status === "cancelled"
        ? "cancelled"
        : row.status === "planned"
          ? "planned"
          : "completed",
    isPublic: row.is_public,
    privacyEnabled: row.privacy_enabled,
    privacyRadiusM: row.privacy_radius_m,
    pointCount: row.point_count,
  };
}

/** A next plan of the person with their role; the meeting point follows the participants' rule. */
export function toMyUpcomingRide(
  entry: Awaited<ReturnType<typeof myUpcomingEntries>>[number],
  viewer: string,
): MyUpcomingRide {
  const view = entry.view;
  const shown = !entry.cancelled && meetingVisible(view, viewer);
  return {
    ...toRideSummary({ ...view, status: "planned" }, viewer),
    // The counts are those of the next live date; a called-off date shows the
    // date the person answered, and the counts of another date would be wrong.
    ...(entry.cancelled ? { participants: null } : {}),
    status: view.status === "cancelled" ? "cancelled" : "planned",
    role: entry.role,
    occurrenceCancelled: entry.occurrenceCancelled,
    changedAfterAnswer: entry.changedAfterAnswer,
    meetingPoint: shown && view.meeting_point ? view.meeting_point : null,
    meetingHidden: !shown && !!view.meeting_point,
  };
}

/** A publication of the feed: the card of its kind, the other three null. */
export function toFeedItem(entry: FeedEntry, viewer: string): FeedItem {
  const base = {
    publishedAt: instantOf(entry.at) ?? "",
    bike: null,
    ride: null,
    journal: null,
    listing: null,
  };
  if (entry.kind === "bike")
    return { ...base, type: "bike", bike: toBikeSummary(entry.bike) };
  if (entry.kind === "ride")
    return { ...base, type: "ride", ride: toRideSummary(entry.ride, viewer) };
  if (entry.kind === "journal")
    return {
      ...base,
      type: "journal",
      journal: toJournalSummary(entry.entry, viewer),
    };
  return { ...base, type: "market", listing: toMarketListing(entry.listing) };
}

const passportRanges = [
  "distanceKm",
  "durationMinutes",
  "groupSize",
  "speedKmh",
] as const;
const passportTexts = [
  "purpose",
  "pace",
  "surface",
  "difficulty",
  "regroupPolicy",
] as const;
/** The plan's passport by field name: unknown keys of the stored JSON are dropped. */
function toPassport(source: RideViewRow["plan_passport"]): Ride["passport"] {
  const passport: NonNullable<Ride["passport"]> = {};
  const value = source as Record<string, unknown>;
  const area = source.area;
  if (area?.label)
    passport.area = {
      label: area.label,
      ...(area.center ? { center: [...area.center] } : {}),
      ...(area.radiusM !== undefined ? { radiusM: area.radiusM } : {}),
    };
  for (const key of passportTexts) {
    const text = value[key];
    if (typeof text === "string") passport[key] = text;
  }
  for (const key of passportRanges) {
    const range = source[key];
    if (range) passport[key] = { min: range.min, max: range.max };
  }
  if (typeof source.beginnerFriendly === "boolean")
    passport.beginnerFriendly = source.beginnerFriendly;
  return passport;
}

/**
 * The ride card. Geometry is the stored public one (already trimmed around the
 * start and the end), the meeting point follows `meetingVisible`, and nothing
 * of the owner's own view (privacy settings, point count, full series,
 * `isPublic`) is read here.
 */
export function toRide(row: RideViewRow, viewer: string | null): Ride {
  const planned = row.source_kind === "planned";
  const visible = meetingVisible(row, viewer);
  const segments = row.public_geometry.filter((line) => line.length > 1);
  const extra: Record<string, number> = {};
  for (const [key, value] of Object.entries(shownMetrics(row)))
    if (typeof value === "number" && Number.isFinite(value)) extra[key] = value;
  return {
    ...toRideSummary(row, viewer),
    description: row.description,
    features: row.features ?? [],
    meetingPoint: visible && row.meeting_point ? row.meeting_point : null,
    meetingHidden: !visible && !!row.meeting_point,
    expectedEndAt:
      planned && row.status === "planned" ? instantOf(plannedEnd(row)) : null,
    recruitmentClosed: planned && !!row.recruitment_closed,
    passport: planned ? toPassport(row.plan_passport) : null,
    geometry: segments.length
      ? { type: "MultiLineString", coordinates: segments }
      : null,
    bounds: segments.length ? bounds(segments) : null,
    extraMetrics: extra,
  };
}

/**
 * A listing of the market. Fields are picked by name from the site's card: the
 * contact and the end of the term exist there only for the owner, and the
 * links to the owner's own records (`ownedBike`, ids for editing) never leave.
 */
export function toMarketListing(
  card: ReturnType<typeof marketApiCard>,
): MarketListing {
  const bike = card.linkedBike;
  return {
    id: card.id,
    title: card.title,
    description: card.description,
    category: card.category,
    listingType: card.listingType as MarketListing["listingType"],
    condition: card.condition,
    price: card.price,
    currency: card.currency,
    location: card.location,
    hasContact: card.hasContact,
    ...(card.contact === undefined ? {} : { contact: card.contact }),
    status: card.status,
    expired: card.expired,
    ...(card.expiresAt ? { expiresAt: instantOf(card.expiresAt) ?? "" } : {}),
    createdAt: instantOf(card.createdAt) ?? "",
    publishedAt: instantOf(card.publishedAt),
    path: card.path,
    photos: card.photos.map((photo) => ({
      id: photo.id,
      url: "/api/market/media/" + photo.id,
    })),
    author: toAuthor(card.author)!,
    isOwner: card.isOwner,
    componentModel: card.componentModel && {
      id: card.componentModel.id,
      name: card.componentModel.name,
      path: card.componentModel.path,
      archived: card.componentModel.archived,
    },
    bikeModel: card.bikeModel && {
      id: card.bikeModel.id,
      name: card.bikeModel.name,
      path: card.bikeModel.path,
      archived: card.bikeModel.archived,
    },
    linkedBike:
      bike && bike.path && bike.isPublic
        ? { id: bike.id, name: bike.name, path: bike.path, isPublic: true }
        : null,
  };
}

/** A listing with the viewer's "saved" mark. */
export function toMarketListingDetail(
  card: ReturnType<typeof marketApiCard> & { saved: boolean },
): MarketListingDetail {
  return { ...toMarketListing(card), saved: card.saved };
}

/**
 * A notice. The card the site builds already follows the visibility rule at
 * read time; here its fields are picked by name, and the site address becomes
 * `path`.
 */
export function toNotification(
  card: ReturnType<typeof notificationCard>,
): Notification {
  const target: {
    type: string;
    id: string;
    name: string;
    href: string;
    commentId: string | null;
    occurrenceAt: Date | null;
    agreementRevision: number | null;
    expiresAt?: Date;
    state?: NotificationTarget["state"];
  } = card.target;
  return {
    id: card.id,
    type: card.type,
    category: card.category,
    createdAt: instantOf(card.createdAt) ?? "",
    readAt: instantOf(card.readAt),
    actor: toAuthor(card.actor),
    reasons: card.reasons,
    target: {
      type: target.type,
      id: target.id,
      name: target.name,
      path: target.href,
      commentId: target.commentId,
      occurrenceAt: instantOf(target.occurrenceAt),
      agreementRevision: target.agreementRevision,
      ...(target.expiresAt
        ? { expiresAt: instantOf(target.expiresAt) ?? "" }
        : {}),
      ...(target.state ? { state: target.state } : {}),
    },
  };
}

/** The settings of an account as the API shows them: the version is the `ETag`, not a field. */
export function toNotificationSettings(
  settings: NotificationSettings,
): NotificationSettingsBody {
  return {
    channels: settings.channels,
    categories: settings.categories,
    reminders: settings.reminders,
    timeZone: settings.timeZone,
    quietHours: settings.quietHours,
    pausedUntil: settings.pausedUntil,
    circle: {
      mode: settings.circle.mode,
      members: settings.circle.members.map((member) => toAuthor(member)!),
    },
    considering: settings.considering,
    mutes: settings.mutes,
    // PostgreSQL's microseconds become the milliseconds every other instant has.
    updatedAt: settings.updatedAt
      ? new Date(settings.updatedAt).toISOString()
      : null,
  };
}

/** A catalog model by name: the page's own fields, nothing of the installations. */
export function toComponentModel(row: CatalogRow): ComponentModel {
  return {
    id: row.id,
    category: row.category,
    brand: row.brand,
    name: row.name,
    description: row.description,
    path: partLandingPath(row.category_slug, row.slug),
    builds: row.builds,
    firstPublicAt: instantOf(row.first_public_at) ?? "",
    coverUrl: row.cover_id ? "/api/components/media/" + row.cover_id : null,
    archived: row.archived,
  };
}

/** A public photo; `first` is the cover. Moderation and editing state stay out. */
export function toComponentPhoto(
  row: ComponentPhotoRow & {
    username: string;
    name: string;
    avatar_id: string;
  },
  first: boolean,
): ComponentPhoto {
  return {
    id: row.id,
    url: "/api/components/media/" + row.id,
    width: row.width,
    height: row.height,
    caption: row.caption,
    source: row.source
      ? {
          provider: row.source.provider,
          url: row.source.url,
          title: row.source.title,
          creator: row.source.creator,
          credit: row.source.credit,
          license: row.source.license,
          licenseUrl: row.source.licenseUrl,
        }
      : null,
    author: author({
      owner_id: row.author_id,
      username: row.username,
      author_name: row.name,
      avatar_id: row.avatar_id,
    }),
    createdAt: instantOf(row.created_at) ?? "",
    isCover: first,
  };
}

const sensorChannels = ["hrBpm", "cadenceRpm", "powerW"] as const;
/** The public series by field name; a sensor the author did not open is absent. */
export function toRideAnalysis(series: {
  channels: AnalysisChannel[];
  pointCount: number;
  downsampled: boolean;
  segments: AnalysisPoint[][];
}): RideAnalysis {
  return {
    channels: series.channels,
    pointCount: series.pointCount,
    downsampled: series.downsampled,
    segments: series.segments.map((run) =>
      run.map((point) => ({
        coord: [point.coord[0], point.coord[1]],
        distanceM: point.distanceM,
        elapsedS: point.elapsedS,
        elevationM: point.elevationM,
        speedMps: point.speedMps,
        gradePct: point.gradePct,
        ...Object.fromEntries(
          sensorChannels
            .filter((key) => point[key] !== undefined)
            .map((key) => [key, point[key]]),
        ),
        gaps: point.gaps,
      })),
    ),
  };
}

export function toJournalSummary(
  row: JournalViewRow,
  viewer: string | null,
): JournalSummary {
  return {
    ...toEntrySummary(row, viewer),
    excerpt: richExcerpt(row.body, 240),
  };
}

/**
 * The entry with its component snapshot. A price is shown to the owner and
 * otherwise only when the owner shows prices of that section, as on the bike.
 */
export function toJournalEntry(
  row: JournalViewRow,
  photos: { id: string }[],
  viewer: string | null,
): JournalEntry {
  const owner = row.owner_id === viewer;
  return {
    ...toEntrySummary(row, viewer),
    body: row.body,
    installationResult: (row.installation_result ??
      null) as JournalEntry["installationResult"],
    // A ride may be private: its link is the owner's alone.
    rideId: owner ? row.ride_id : null,
    components: row.components.map((part) => ({
      id: part.id,
      modelId: part.model_id ?? null,
      section: part.section,
      category: part.category,
      name: part.name,
      notes: part.notes ?? "",
      url: part.url ?? "",
      groupId: part.group_id ?? "",
      sortOrder: part.sort_order ?? 0,
      price:
        owner ||
        (part.section === "build"
          ? row.show_component_prices
          : row.show_accessory_prices)
          ? amount(part.price)
          : null,
      capturedAt: part.capturedAt
        ? new Date(part.capturedAt).toISOString()
        : null,
    })),
    photos: photos.map((photo) => ({
      id: photo.id,
      url: "/api/journal/media/" + photo.id,
    })),
  };
}

/** A hidden, deleted or blocked author's comment is a tombstone: no text, no author. */
export function toComment(row: CommentRow): Comment {
  const hidden = !!row.deleted_at || !row.author_id || !!row.blocked;
  return {
    id: row.id,
    parentId: row.parent_id,
    author: hidden
      ? null
      : {
          id: row.author_id as string,
          username: row.username as string,
          name: row.name as string,
          avatarUrl: avatarUrl(row.avatar_id),
        },
    body: hidden ? null : row.body,
    createdAt: iso(row.created_at),
    editedAt:
      !hidden && row.updated_at > row.created_at ? iso(row.updated_at) : null,
    deleted: hidden,
    replyCount: Number(row.reply_count || 0),
  };
}

export function toPushDevice(device: PushDevice): PushDeviceBody {
  return {
    provider: device.provider,
    projectId: device.projectId,
    generation: device.generation,
    registeredAt: device.registeredAt.toISOString(),
    updatedAt: device.updatedAt.toISOString(),
    lastSeenAt: device.lastSeenAt.toISOString(),
  };
}

/** An intention to ride as the site's service shows it to this viewer. */
export function toRideIntent(
  intent: Awaited<ReturnType<typeof intentDetail>>,
): RideIntent {
  return {
    id: intent.id,
    own: intent.own,
    readiness: intent.readiness,
    timeZone: intent.timeZone,
    passport: toPassport(intent.passport as RideViewRow["plan_passport"]) ?? {},
    windows: intent.windows.map((window) => ({
      startsAt: window.startsAt,
      endsAt: window.endsAt,
    })),
    ...(intent.meetNewPeople === undefined
      ? {}
      : { meetNewPeople: intent.meetNewPeople }),
    visibility: intent.visibility,
    status: intent.status as RideIntent["status"],
    ...("allowSuggestions" in intent
      ? { allowSuggestions: intent.allowSuggestions }
      : {}),
    author: toAuthor(intent.author)!,
    createdAt: iso(intent.createdAt),
    updatedAt: iso(intent.updatedAt),
  };
}

/**
 * The person's part in a planned ride. Fields are picked by name; no other
 * person is named. The description, the place and the passport are read only
 * while the plan is a live one the person may read in full: for a plan that was
 * called off and is known only through an earlier answer, only the fact is.
 */
export function toRideParticipation(
  state: ParticipationState,
  viewer: string,
): RideParticipation {
  const row = state.row;
  const detailed = row.status === "planned" && state.access !== "answered";
  const place = detailed && meetingVisible(row, viewer);
  const counts = row.rsvp_counts ?? {};
  const answered = ["accepted", "maybe", "declined"].includes(
    state.participation,
  )
    ? (state.participation as "accepted" | "maybe" | "declined")
    : null;
  return {
    rideId: row.id,
    title: row.title,
    status: row.status as RideParticipation["status"],
    description: detailed ? row.description : null,
    features: detailed ? (row.features ?? []) : [],
    author: author(row),
    timeZone: row.recurrence_timezone || "Europe/Moscow",
    recurrence: row.recurrence === "weekly" ? "weekly" : "none",
    scheduledAt: instantOf(state.scheduledAt),
    expectedEndAt:
      detailed && state.scheduledAt ? instantOf(plannedEnd(row)) : null,
    requested: state.requested && {
      at: iso(state.requested.at),
      status: state.requested.status,
    },
    agreement: {
      revision: row.agreement_revision || 1,
      changes: (row.agreement_changes ?? []).filter(
        (change): change is "start" | "place" | "route" =>
          change === "start" || change === "place" || change === "route",
      ),
      changedAt: instantOf(row.agreement_changed_at),
    },
    recruitmentClosed: detailed && !!row.recruitment_closed,
    meetingPoint: place && row.meeting_point ? row.meeting_point : null,
    meetingHidden: detailed && !place && !!row.meeting_point,
    passport: detailed ? toPassport(row.plan_passport) : null,
    participants: { going: counts.accepted ?? 0, maybe: counts.maybe ?? 0 },
    viewer: {
      role:
        state.access === "organizer"
          ? "organizer"
          : row.invited
            ? "invitee"
            : "visitor",
      participation: state.participation,
      response: answered,
      previousResponse:
        state.participation === "reconfirm" && row.rsvp ? row.rsvp : null,
      changedAfterAnswer: state.participation === "reconfirm",
      allowedResponses: state.allowedResponses,
    },
  };
}

/** The area and settings of "rides near me": the cell and the terms, nothing else. */
/** The current offers: the public list card of each plan and why it is offered. */
export function toNearbyOffers(
  state: NearbyOffersState,
  rows: Array<RideViewRow & { intent_match?: boolean }>,
  viewer: string,
): NearbyOffers {
  return {
    state,
    items: rows.map((row) => ({
      ride: toRideSummary(row, viewer),
      reasons: row.intent_match
        ? (["nearby", "intent"] as Array<"nearby" | "intent">)
        : (["nearby"] as Array<"nearby" | "intent">),
    })),
  };
}

export function toNearby(state: NearbyState): Nearby {
  return {
    available: state.available,
    enabled: state.enabled,
    source: state.source,
    area: state.area && {
      label: state.area.label,
      center: [...state.area.center],
      radiusM: state.area.radiusM,
    },
    observedAt: instantOf(state.observedAt),
    expiresAt: instantOf(state.expiresAt),
    expired: state.expired,
    horizonDays: state.horizonDays,
    filters: {
      purposes: [...state.filters.purposes],
      paces: [...state.filters.paces],
      surfaces: [...state.filters.surfaces],
    },
    limits: {
      minRadiusM: state.limits.minRadiusM,
      maxRadiusM: state.limits.maxRadiusM,
      radiusStepM: state.limits.radiusStepM,
      deviceTtlHours: state.limits.deviceTtlHours,
      cell: { ...state.limits.cell },
    },
  };
}
