import type { Queryable } from "./db.ts";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { hashPassword, verifyPassword } from "./password.ts";
import { consumeToken, issueToken } from "./account.ts";
import { avatarFilename } from "./avatars.ts";
import { purgeMediaVariants } from "./media-cache.ts";

// The account's own security and data (#70): devices, password, address,
// deletion and export. Every function takes the transaction client first;
// routes check the session and the request origin before calling them.

const uploads = () =>
  path.resolve(/*turbopackIgnore: true*/ process.env.UPLOAD_DIR || "uploads");

// The user row locked for the change, with the stored password hash.
async function lockedUser(q: Queryable, userId: string) {
  return (
    await q.query<{
      id: string;
      name: string;
      email: string;
      role: string;
      password_hash: string | null;
      avatar_id: string;
    }>(
      "SELECT id,name,email,role,password_hash,avatar_id FROM users WHERE id=$1 AND NOT blocked FOR UPDATE",
      [userId],
    )
  ).rows[0];
}

async function checkPassword(
  user: Awaited<ReturnType<typeof lockedUser>>,
  password: string,
) {
  return (
    !!user &&
    user.password_hash !== null &&
    (await verifyPassword(password, user.password_hash))
  );
}

// An account made through an external provider has no password until it sets
// one through recovery (#151); these actions then have nothing to confirm with.
const noPasswordMessage =
  "У аккаунта нет пароля. Задайте его через «Забыли пароль?» и повторите.";

// ── Devices ──────────────────────────────────────────────────────────────

/** Active sessions, newest first; `current` marks this browser or device. */
export async function listSessions(
  q: Queryable,
  userId: string,
  currentHash: string | null,
) {
  const { rows } = await q.query<{
    id: string;
    created_at: Date;
    last_seen_at: Date;
    user_agent: string;
    kind: "browser" | "device";
    device_name: string | null;
    platform: "ios" | "android" | "other" | null;
    app_version: string | null;
    current: boolean | null;
  }>(
    `SELECT id,created_at,last_seen_at,user_agent,kind,device_name,platform,app_version,token_hash=$2 AS current
     FROM sessions WHERE user_id=$1 AND expires_at>now()
     ORDER BY (token_hash=$2) DESC,last_seen_at DESC`,
    [userId, currentHash],
  );
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
    userAgent: r.user_agent,
    kind: r.kind,
    deviceName: r.device_name,
    platform: r.platform,
    appVersion: r.app_version,
    current: r.current,
  }));
}

/** Ends one session by its public id; the current one included. */
export async function endSessionById(q: Queryable, userId: string, id: string) {
  const { rowCount } = await q.query(
    "DELETE FROM sessions WHERE user_id=$1 AND id=$2",
    [userId, id],
  );
  return (rowCount ?? 0) > 0;
}

/** «Sign out everywhere»: every session of the account ends. */
export async function endAllSessions(q: Queryable, userId: string) {
  await q.query("DELETE FROM sessions WHERE user_id=$1", [userId]);
}

// ── Password ─────────────────────────────────────────────────────────────

/**
 * Checks the current password, stores the new one and ends every other
 * session: a stolen session does not outlive the change.
 */
export async function changePassword(
  q: Queryable,
  userId: string,
  current: string,
  next: string,
  currentHash: string | null,
) {
  const user = await lockedUser(q, userId);
  if (user && user.password_hash === null)
    return { error: noPasswordMessage, status: 409 };
  if (!(await checkPassword(user, current)))
    return { error: "Текущий пароль не подходит", status: 403 };
  if (current === next)
    return { error: "Новый пароль совпадает с текущим", status: 400 };
  await q.query(
    "UPDATE users SET password_hash=$2,password_changed_at=now() WHERE id=$1",
    [userId, await hashPassword(next)],
  );
  await q.query(
    "DELETE FROM auth_tokens WHERE user_id=$1 AND purpose='password_reset'",
    [userId],
  );
  await q.query(
    "DELETE FROM sessions WHERE user_id=$1 AND token_hash IS DISTINCT FROM $2",
    [userId, currentHash],
  );
  return { ok: true };
}

// ── Email address ────────────────────────────────────────────────────────

/**
 * Checks the password and issues a link to the new address. The address
 * changes only when that link is opened (confirmEmailChange).
 */
export async function requestEmailChange(
  q: Queryable,
  userId: string,
  password: string,
  email: string,
) {
  const user = await lockedUser(q, userId);
  if (user && user.password_hash === null)
    return { error: noPasswordMessage, status: 409 };
  if (!(await checkPassword(user, password)))
    return { error: "Пароль не подходит", status: 403 };
  if (email === user.email)
    return { error: "Это уже адрес вашего аккаунта", status: 400 };
  const taken = await q.query<{ "?column?": number }>(
    "SELECT 1 FROM users WHERE email=$1",
    [email],
  );
  if (taken.rowCount)
    return {
      error: "Этот адрес нельзя использовать. Укажите другой.",
      status: 409,
    };
  return {
    user,
    token: await issueToken(q, userId, "email_change", email),
  };
}

/**
 * Applies a change link. Returns null for an invalid, used or expired link,
 * { taken: true } when the address was claimed meanwhile, otherwise the
 * old and new addresses.
 */
export async function confirmEmailChange(q: Queryable, token: string) {
  const row = await consumeToken(q, token, "email_change");
  if (!row) return null;
  const taken = await q.query<{ "?column?": number }>(
    "SELECT 1 FROM users WHERE email=$1",
    [row.email],
  );
  if (taken.rowCount) return { taken: true as const };
  // Opening the link proves the new mailbox, so it is verified at once.
  await q.query(
    "UPDATE users SET email=$2,email_verified_at=now() WHERE id=$1",
    [row.user_id, row.email],
  );
  // Links sent to the old address stop working.
  await q.query(
    "DELETE FROM auth_tokens WHERE user_id=$1 AND used_at IS NULL",
    [row.user_id],
  );
  return {
    userId: row.user_id,
    name: row.name,
    previous: row.current_email,
    email: row.email,
  };
}

// ── Deletion ─────────────────────────────────────────────────────────────

/**
 * Files that belong to the account and have no database queue: bike photos
 * and the avatar. Rides, journal and market photos are queued by triggers
 * when their rows go (ride_file_gc, journal_photo_gc, market_photo_gc).
 */
export async function accountFiles(q: Queryable, userId: string) {
  const photos = (
    await q.query<{ id: string; filename: string }>(
      "SELECT p.id,p.filename FROM photos p JOIN bikes b ON b.id=p.bike_id WHERE b.owner_id=$1",
      [userId],
    )
  ).rows;
  const avatar = (
    await q.query<{ avatar_id: string }>(
      "SELECT avatar_id FROM users WHERE id=$1",
      [userId],
    )
  ).rows[0]?.avatar_id;
  return {
    filenames: [
      ...photos.map((p) => p.filename),
      ...(avatar ? [avatarFilename(avatar)] : []),
    ],
    media: [
      ...photos.map((p) => p.id),
      ...(avatar ? ["avatar-" + avatar] : []),
    ],
  };
}

/** Removes files after the transaction has committed. */
export async function removeAccountFiles({
  filenames,
  media,
}: {
  filenames: string[];
  media: string[];
}) {
  await Promise.all(
    filenames.map((f: string) =>
      unlink(path.join(uploads(), f)).catch(() => {}),
    ),
  );
  await purgeMediaVariants(media);
}

/**
 * Deletes the signed-in account after checking its password. Rows go by
 * cascade: bikes, journal, rides, market, follows, sessions, notifications
 * where the person acts; their comments stay as «unavailable».
 */
export async function deleteAccount(
  q: Queryable,
  userId: string,
  password: string,
) {
  const user = await lockedUser(q, userId);
  if (user && user.password_hash === null)
    return { error: noPasswordMessage, status: 409 };
  if (!(await checkPassword(user, password)))
    return { error: "Пароль не подходит", status: 403 };
  if (user.role === "admin")
    return {
      error:
        "Администратор не может удалить свой аккаунт. Сначала передайте права другому администратору.",
      status: 409,
    };
  const files = await accountFiles(q, userId);
  await q.query("DELETE FROM users WHERE id=$1", [userId]);
  return { ok: true, files };
}

// ── Export ───────────────────────────────────────────────────────────────

const absolute = (origin: string | URL | undefined, href: string | URL) =>
  new URL(href, origin).toString();

/**
 * Everything the account owns, as one JSON document: profile, bikes with
 * components, journal entries, rides and listings, with links to photos
 * and ride tracks (the links work for the signed-in owner).
 */
export async function exportAccount(
  q: Queryable,
  userId: string,
  origin: string,
) {
  const profile = (
    await q.query<{
      id: string;
      email: string;
      name: string;
      username: string;
      bio: string;
      location: string;
      created_at: Date;
      email_verified_at: Date;
      avatar_id: string;
      preferences: unknown;
    }>(
      "SELECT id,email,name,username,bio,location,created_at,email_verified_at,avatar_id,preferences FROM users WHERE id=$1",
      [userId],
    )
  ).rows[0];
  const bikes = (
    await q.query<{
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
      weight: string;
      is_public: boolean;
      share_id: string;
      created_at: Date;
      updated_at: Date;
      trim: string;
      factory_spec: unknown;
      manufacturer_url: string;
      price: string;
      show_bike_price: boolean;
      show_component_prices: boolean;
      show_accessory_prices: boolean;
      group_order: unknown;
      mileage: number;
      published_at: Date;
      leaderboard_excluded: boolean;
      purposes: string[];
      classification: unknown;
      is_former: boolean;
      public_id: string;
      slug: string;
      catalog_model_id: string;
      components: unknown;
      photo_ids: string[];
    }>(
      `SELECT b.*,
        (SELECT coalesce(jsonb_agg(to_jsonb(c) - 'bike_id' ORDER BY c.sort_order,c.created_at,c.id),'[]') FROM components c WHERE c.bike_id=b.id) components,
        (SELECT coalesce(jsonb_agg(p.id ORDER BY p.created_at,p.id),'[]') FROM photos p WHERE p.bike_id=b.id) photo_ids
       FROM bikes b WHERE b.owner_id=$1 ORDER BY b.created_at,b.id`,
      [userId],
    )
  ).rows;
  const journal = (
    await q.query<{
      id: string;
      bike_id: string;
      kind: string;
      title: string;
      body: string;
      status: string;
      is_public: boolean;
      event_date: Date;
      mileage: number;
      created_at: Date;
      updated_at: Date;
      photo_ids: string[];
    }>(
      `SELECT e.id,e.bike_id,e.kind,e.title,e.body,e.status,e.is_public,e.event_date,e.mileage,e.created_at,e.updated_at,
        (SELECT coalesce(jsonb_agg(p.id ORDER BY p.created_at,p.id),'[]') FROM journal_photos p WHERE p.entry_id=e.id) photo_ids
       FROM journal_entries e WHERE e.owner_id=$1 ORDER BY e.created_at,e.id`,
      [userId],
    )
  ).rows;
  const rides = (
    await q.query<{
      id: string;
      bike_id: string;
      title: string;
      description: string;
      started_at: Date;
      ended_at: Date;
      distance_m: number;
      elapsed_time_s: number;
      moving_time_s: number;
      avg_speed_mps: string;
      elevation_gain_m: string;
      is_public: boolean;
      has_track: boolean;
      created_at: Date;
    }>(
      `SELECT id,bike_id,title,description,started_at,ended_at,distance_m,elapsed_time_s,moving_time_s,avg_speed_mps,elevation_gain_m,is_public,has_track,created_at
       FROM rides WHERE owner_id=$1 ORDER BY started_at NULLS LAST,id`,
      [userId],
    )
  ).rows;
  const listings = (
    await q.query<{
      id: string;
      title: string;
      description: string;
      category: string;
      condition: string;
      price: string;
      currency: string;
      location: string;
      contact: string;
      status: string;
      created_at: Date;
      published_at: Date;
      expires_at: Date;
      component_model_id: string;
      bike_model_id: string;
      linked_bike_id: string;
      photo_ids: string[];
    }>(
      `SELECT m.id,m.title,m.description,m.category,m.condition,m.price,m.currency,m.location,m.contact,m.status,m.created_at,m.published_at,m.expires_at,m.component_model_id,m.bike_model_id,m.linked_bike_id,
        (SELECT coalesce(jsonb_agg(p.id ORDER BY p.created_at,p.id),'[]') FROM market_photos p WHERE p.listing_id=m.id) photo_ids
       FROM market_listings m WHERE m.owner_id=$1 ORDER BY m.created_at,m.id`,
      [userId],
    )
  ).rows;
  const componentPhotos = (
    await q.query<{
      id: string;
      model_id: string;
      caption: string;
      source: unknown;
      hidden: boolean;
      created_at: Date;
      catalog_id: string;
    }>(
      `SELECT p.id,p.model_id,p.caption,p.source,p.hidden,p.created_at,coalesce(m.merged_into,m.id) catalog_id
     FROM component_photos p JOIN component_models m ON m.id=p.model_id WHERE p.author_id=$1 ORDER BY p.created_at,p.id`,
      [userId],
    )
  ).rows;
  const rideIntents = (
    await q.query<{
      id: string;
      readiness: string;
      time_zone: string;
      passport: unknown;
      meet_new_people: boolean;
      visibility: string;
      allow_suggestions: boolean;
      status: string;
      created_at: Date;
      updated_at: Date;
      windows: unknown;
    }>(
      `SELECT i.id,i.readiness,i.time_zone,i.passport,i.meet_new_people,i.visibility,i.allow_suggestions,i.status,i.created_at,i.updated_at,
    (SELECT coalesce(jsonb_agg(jsonb_build_object('startsAt',w.starts_at,'endsAt',w.ends_at) ORDER BY w.starts_at),'[]') FROM ride_intent_windows w WHERE w.intent_id=i.id) windows
    FROM ride_intents i WHERE i.owner_id=$1 AND i.status<>'deleted' ORDER BY i.created_at,i.id`,
      [userId],
    )
  ).rows;
  const rideIntentPreferences = (
    await q.query<{ value: unknown }>(
      "SELECT value FROM ride_intent_preferences WHERE owner_id=$1",
      [userId],
    )
  ).rows[0]?.value || { passport: {} };
  const link = (href: string) => absolute(origin, href);
  const notificationSettingsRow = (
    await q.query<{
      reminders: boolean;
      push_enabled: boolean;
      push_categories: unknown;
      time_zone: string | null;
      quiet_enabled: boolean;
      quiet_from: number;
      quiet_to: number;
      quiet_cancel: boolean;
      paused_until: Date | null;
      circle: string;
      considering: boolean;
      updated_at: Date | null;
    }>(
      `SELECT reminders,push_enabled,push_categories,time_zone,quiet_enabled,quiet_from,quiet_to,quiet_cancel,paused_until,circle,considering,updated_at
      FROM notification_settings WHERE user_id=$1`,
      [userId],
    )
  ).rows[0];
  const circleMembers = (
    await q.query<{ username: string }>(
      "SELECT u.username FROM notification_circle_members c JOIN users u ON u.id=c.member_id WHERE c.user_id=$1 ORDER BY c.created_at,u.id",
      [userId],
    )
  ).rows.map((row) => row.username);
  const notificationMutes = (
    await q.query<{ kind: string; target_id: string }>(
      "SELECT kind,target_id FROM notification_mutes WHERE user_id=$1 ORDER BY created_at,target_id",
      [userId],
    )
  ).rows.map((row) => ({ kind: row.kind, id: row.target_id }));
  const notificationEmailPreferences = {
    ...((
      await q.query<{
        enabled: boolean;
        discussions: boolean;
        rides: boolean;
        market: boolean;
        updated_at: Date;
      }>(
        "SELECT enabled,discussions,rides,market,updated_at FROM notification_email_preferences WHERE user_id=$1",
        [userId],
      )
    ).rows[0] || {
      enabled: false,
      discussions: false,
      rides: false,
      market: false,
    }),
    reminders: notificationSettingsRow?.reminders ?? true,
  };
  // What the account chose for the channels other than e-mail (#341). The
  // registration of a phone is a different record and is not exported here.
  const notificationSettings = {
    reminders: notificationSettingsRow?.reminders ?? true,
    push: {
      enabled: notificationSettingsRow?.push_enabled ?? false,
      categories: notificationSettingsRow?.push_categories ?? {},
    },
    timeZone: notificationSettingsRow?.time_zone ?? null,
    quietHours: {
      enabled: notificationSettingsRow?.quiet_enabled ?? false,
      from: notificationSettingsRow?.quiet_from ?? 1320,
      to: notificationSettingsRow?.quiet_to ?? 420,
      allowCancellations: notificationSettingsRow?.quiet_cancel ?? false,
    },
    pausedUntil: notificationSettingsRow?.paused_until ?? null,
    circle: {
      mode: notificationSettingsRow?.circle ?? "friends",
      members: circleMembers,
    },
    considering: notificationSettingsRow?.considering ?? false,
    mutes: notificationMutes,
    updatedAt: notificationSettingsRow?.updated_at ?? null,
  };
  return {
    format: "colabike-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    profile: {
      id: profile.id,
      email: profile.email,
      emailVerifiedAt: profile.email_verified_at,
      name: profile.name,
      username: profile.username,
      bio: profile.bio,
      location: profile.location,
      createdAt: profile.created_at,
      preferences: profile.preferences,
      avatar: profile.avatar_id
        ? link("/api/avatars/" + profile.avatar_id)
        : null,
    },
    bikes: bikes.map(({ photo_ids, components, owner_id, ...bike }) => {
      void owner_id;
      return {
        ...bike,
        components,
        photos: photo_ids.map((id: string) => link("/api/photos/" + id)),
      };
    }),
    journal: journal.map(({ photo_ids, ...entry }) => ({
      ...entry,
      photos: photo_ids.map((id: string) => link("/api/journal/media/" + id)),
    })),
    rides: rides.map((ride) => ({
      ...ride,
      track: ride.has_track
        ? link("/api/account/export/rides/" + ride.id)
        : null,
    })),
    market: listings.map(({ photo_ids, ...listing }) => ({
      ...listing,
      photos: photo_ids.map((id: string) => link("/api/market/media/" + id)),
    })),
    rideIntents,
    rideIntentPreferences,
    notificationEmailPreferences,
    notificationSettings,
    componentPhotos: componentPhotos.map((p) => ({
      ...p,
      url: link("/api/components/media/" + p.id),
    })),
  };
}

/** The owner's original track of one ride, or null. */
export async function ownRideTrack(
  q: Queryable,
  userId: string,
  rideId: string,
) {
  return (
    (
      await q.query<{ id: string; title: string; track_file_id: string }>(
        "SELECT id,title,track_file_id FROM rides WHERE id=$1 AND owner_id=$2 AND has_track",
        [rideId, userId],
      )
    ).rows[0] || null
  );
}
