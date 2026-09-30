import type { PublicAuthor as PublicAuthorType } from "./contracts.ts";
import type { AuthorRow as AuthorRowType } from "./contracts.ts";
import type { Relationship as RelationshipType } from "./contracts.ts";
import type { PublicProfile as PublicProfileType } from "./contracts.ts";
// Public users are explicit DTOs. Never spread a row or expose preferences/email.

export const publicAuthorKeys = /** @type {const} */ [
  "id",
  "username",
  "name",
  "avatar",
] as const;

export function publicAuthor(row: AuthorRow): PublicAuthor;
export function publicAuthor(row: null | undefined): null;
export function publicAuthor(
  row: AuthorRow | null | undefined,
): PublicAuthor | null;
export function publicAuthor(
  row: AuthorRow | null | undefined,
): PublicAuthor | null {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    avatar: row.avatar_id ? "/api/avatars/" + row.avatar_id : null,
  };
}

export function relationship(
  row: {
    is_self?: boolean;
    is_following?: boolean;
    followed_by?: boolean;
  } = {},
): Relationship {
  const following = !!row.is_following,
    followedBy = !!row.followed_by;
  return {
    isSelf: !!row.is_self,
    following,
    followedBy,
    friends: following && followedBy,
  };
}

export function publicProfile(
  row: AuthorRow & {
    bio: string;
    location: string;
    created_at: Date | string;
    is_self?: boolean;
    is_following?: boolean;
    followed_by?: boolean;
  },
  counts: {
    bikes: number | string;
    followers: number | string;
    following: number | string;
    friends: number | string;
  },
): PublicProfile {
  return {
    ...publicAuthor(row),
    bio: row.bio,
    location: row.location,
    createdAt: row.created_at,
    counts: {
      bikes: Number(counts.bikes),
      followers: Number(counts.followers),
      following: Number(counts.following),
      friends: Number(counts.friends),
    },
    relationship: relationship(row),
    badges: [],
  };
}

export type PublicAuthor = PublicAuthorType;
export type AuthorRow = AuthorRowType;
export type Relationship = RelationshipType;
export type PublicProfile = PublicProfileType;
