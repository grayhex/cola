import { randomUUID } from "node:crypto";
import type { CurrentUser } from "../../lib/contracts.ts";
import type { Queryable } from "../../lib/db.ts";
import type { UserRow } from "../../lib/database-rows.ts";
import { given, insertRow, type Columns, unique } from "./rows.ts";

/**
 * A stored user: confirmed by default, no avatar, a unique username and
 * address. `overrides` are columns of `users`.
 */
export async function userRow(
  q: Queryable,
  overrides: Columns<UserRow> = {},
): Promise<UserRow> {
  const id = overrides.id ?? randomUUID();
  return insertRow<UserRow>(q, "users", {
    id,
    email: `${id}@example.test`,
    name: "Rider",
    password_hash: "hash",
    username: "u" + unique(),
    ...given(overrides),
  });
}

/** The server's snapshot of a signed-in person, for code that takes a viewer. */
export function viewer(overrides: Partial<CurrentUser> = {}): CurrentUser {
  const id = overrides.id ?? randomUUID();
  return {
    id,
    email: `${id}@example.test`,
    name: "Rider",
    role: "user",
    preferences: {},
    username: "u" + id.replaceAll("-", "").slice(0, 12),
    bio: "",
    location: "",
    created_at: new Date("2026-01-01T00:00:00Z"),
    avatar_id: null,
    email_verified_at: new Date("2026-01-01T00:00:00Z"),
    ...given(overrides),
  };
}

/**
 * A person known by a label in a test: "Имя label" and a username made of the
 * label and a slice of the id. The address is `…@test.invalid`, the domain the
 * privacy assertions of the API tests look for in answers.
 */
export function labelledUser(
  q: Queryable,
  label: string,
  overrides: Columns<UserRow> = {},
): Promise<UserRow> {
  const id = overrides.id ?? randomUUID();
  return userRow(q, {
    id,
    email: id + "@test.invalid",
    name: "Имя " + label,
    username: (label + "-" + id.slice(0, 8)).toLowerCase(),
    ...given(overrides),
  });
}
