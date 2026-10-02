// Who may read a bike (#134): one definition for the web pages, the legacy
// API and /api/v1. The SQL fragments expect the aliases `b` (bikes) and `u`
// (the bike's owner); every value reaches the query as a parameter.

/** Public bikes of accounts in good standing. */
export const publicBikeSql = "b.is_public=true AND u.blocked=false";

/**
 * A bike its viewer may read: a public one, or their own. `viewer` is a
 * `$n` placeholder holding the viewer's id, or null for a guest.
 */
export const readableBikeSql = (viewer: string) =>
  `(b.is_public=true OR b.owner_id=${viewer}) AND u.blocked=false`;
