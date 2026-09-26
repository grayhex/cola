import { unlink } from "node:fs/promises";
import path from "node:path";
import { hashPassword, verifyPassword } from "./password.js";
import { consumeToken, issueToken } from "./account.js";
import { avatarFilename } from "./avatars.js";
import { purgeMediaVariants } from "./media-cache.js";

// The account's own security and data (#70): devices, password, address,
// deletion and export. Every function takes the transaction client first;
// routes check the session and the request origin before calling them.

const uploads = () =>
  path.resolve(/*turbopackIgnore: true*/ process.env.UPLOAD_DIR || "uploads");

// The user row locked for the change, with the stored password hash.
async function lockedUser(q, userId) {
  return (
    await q.query(
      "SELECT id,name,email,role,password_hash,avatar_id FROM users WHERE id=$1 AND NOT blocked FOR UPDATE",
      [userId],
    )
  ).rows[0];
}

async function checkPassword(user, password) {
  return !!user && (await verifyPassword(password, user.password_hash));
}

// ── Devices ──────────────────────────────────────────────────────────────

/** Active sessions, newest first; `current` marks this browser. */
export async function listSessions(q, userId, currentHash) {
  const { rows } = await q.query(
    `SELECT id,created_at,last_seen_at,user_agent,token_hash=$2 AS current
     FROM sessions WHERE user_id=$1 AND expires_at>now()
     ORDER BY (token_hash=$2) DESC,last_seen_at DESC`,
    [userId, currentHash],
  );
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
    userAgent: r.user_agent,
    current: r.current,
  }));
}

/** Ends one session by its public id; the current one included. */
export async function endSessionById(q, userId, id) {
  const { rowCount } = await q.query(
    "DELETE FROM sessions WHERE user_id=$1 AND id=$2",
    [userId, id],
  );
  return rowCount > 0;
}

/** «Sign out everywhere»: every session of the account ends. */
export async function endAllSessions(q, userId) {
  await q.query("DELETE FROM sessions WHERE user_id=$1", [userId]);
}

// ── Password ─────────────────────────────────────────────────────────────

/**
 * Checks the current password, stores the new one and ends every other
 * session: a stolen session does not outlive the change.
 */
export async function changePassword(q, userId, current, next, currentHash) {
  const user = await lockedUser(q, userId);
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
export async function requestEmailChange(q, userId, password, email) {
  const user = await lockedUser(q, userId);
  if (!(await checkPassword(user, password)))
    return { error: "Пароль не подходит", status: 403 };
  if (email === user.email)
    return { error: "Это уже адрес вашего аккаунта", status: 400 };
  const taken = await q.query("SELECT 1 FROM users WHERE email=$1", [email]);
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
export async function confirmEmailChange(q, token) {
  const row = await consumeToken(q, token, "email_change");
  if (!row) return null;
  const taken = await q.query("SELECT 1 FROM users WHERE email=$1", [
    row.email,
  ]);
  if (taken.rowCount) return { taken: true };
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
export async function accountFiles(q, userId) {
  const photos = (
    await q.query(
      "SELECT p.id,p.filename FROM photos p JOIN bikes b ON b.id=p.bike_id WHERE b.owner_id=$1",
      [userId],
    )
  ).rows;
  const avatar = (
    await q.query("SELECT avatar_id FROM users WHERE id=$1", [userId])
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
export async function removeAccountFiles({ filenames, media }) {
  await Promise.all(
    filenames.map((f) => unlink(path.join(uploads(), f)).catch(() => {})),
  );
  await purgeMediaVariants(media);
}

/**
 * Deletes the signed-in account after checking its password. Rows go by
 * cascade: bikes, journal, rides, market, follows, sessions, notifications
 * where the person acts; their comments stay as «unavailable».
 */
export async function deleteAccount(q, userId, password) {
  const user = await lockedUser(q, userId);
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

const absolute = (origin, href) => new URL(href, origin).toString();

/**
 * Everything the account owns, as one JSON document: profile, bikes with
 * components, journal entries, rides and listings, with links to photos
 * and ride tracks (the links work for the signed-in owner).
 */
export async function exportAccount(q, userId, origin) {
  const profile = (
    await q.query(
      "SELECT id,email,name,username,bio,location,created_at,email_verified_at,avatar_id,preferences FROM users WHERE id=$1",
      [userId],
    )
  ).rows[0];
  const bikes = (
    await q.query(
      `SELECT b.*,
        (SELECT coalesce(jsonb_agg(to_jsonb(c) - 'bike_id' ORDER BY c.sort_order,c.created_at,c.id),'[]') FROM components c WHERE c.bike_id=b.id) components,
        (SELECT coalesce(jsonb_agg(p.id ORDER BY p.created_at,p.id),'[]') FROM photos p WHERE p.bike_id=b.id) photo_ids
       FROM bikes b WHERE b.owner_id=$1 ORDER BY b.created_at,b.id`,
      [userId],
    )
  ).rows;
  const journal = (
    await q.query(
      `SELECT e.id,e.bike_id,e.kind,e.title,e.body,e.status,e.is_public,e.event_date,e.mileage,e.created_at,e.updated_at,
        (SELECT coalesce(jsonb_agg(p.id ORDER BY p.created_at,p.id),'[]') FROM journal_photos p WHERE p.entry_id=e.id) photo_ids
       FROM journal_entries e WHERE e.owner_id=$1 ORDER BY e.created_at,e.id`,
      [userId],
    )
  ).rows;
  const rides = (
    await q.query(
      `SELECT id,bike_id,title,description,started_at,ended_at,distance_m,elapsed_time_s,moving_time_s,avg_speed_mps,elevation_gain_m,is_public,has_track,created_at
       FROM rides WHERE owner_id=$1 ORDER BY started_at NULLS LAST,id`,
      [userId],
    )
  ).rows;
  const listings = (
    await q.query(
      `SELECT m.id,m.title,m.description,m.category,m.condition,m.price,m.currency,m.location,m.contact,m.status,m.created_at,m.published_at,m.expires_at,
        (SELECT coalesce(jsonb_agg(p.id ORDER BY p.created_at,p.id),'[]') FROM market_photos p WHERE p.listing_id=m.id) photo_ids
       FROM market_listings m WHERE m.owner_id=$1 ORDER BY m.created_at,m.id`,
      [userId],
    )
  ).rows;
  const componentPhotos = (await q.query(
    `SELECT p.id,p.model_id,p.caption,p.hidden,p.created_at,coalesce(m.merged_into,m.id) catalog_id
     FROM component_photos p JOIN component_models m ON m.id=p.model_id WHERE p.author_id=$1 ORDER BY p.created_at,p.id`, [userId],
  )).rows;
  const link = (href) => absolute(origin, href);
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
        photos: photo_ids.map((id) => link("/api/photos/" + id)),
      };
    }),
    journal: journal.map(({ photo_ids, ...entry }) => ({
      ...entry,
      photos: photo_ids.map((id) => link("/api/journal/media/" + id)),
    })),
    rides: rides.map((ride) => ({
      ...ride,
      track: ride.has_track
        ? link("/api/account/export/rides/" + ride.id)
        : null,
    })),
    market: listings.map(({ photo_ids, ...listing }) => ({
      ...listing,
      photos: photo_ids.map((id) => link("/api/market/media/" + id)),
    })),
    componentPhotos: componentPhotos.map(p => ({ ...p, url: link("/api/components/media/" + p.id) })),
  };
}

/** The owner's original track of one ride, or null. */
export async function ownRideTrack(q, userId, rideId) {
  return (
    (
      await q.query(
        "SELECT id,title FROM rides WHERE id=$1 AND owner_id=$2 AND has_track",
        [rideId, userId],
      )
    ).rows[0] || null
  );
}
