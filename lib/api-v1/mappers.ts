import type { CurrentUser, PublicAuthor, SocialBike } from "../contracts.ts";
import type { visibleBikeById } from "../showcase.ts";
import type { listSessions } from "../account-data.ts";
import type { TokenGrant } from "../device-sessions.ts";
import type {
  AccountSession,
  Bike,
  BikeSummary,
  Me,
  SessionGrant,
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
const toPhoto = (photo: PhotoSource) => ({
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
    components: bike.components.map((part) => ({
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
    })),
    photos: bike.photos.map(toPhoto),
  };
}
