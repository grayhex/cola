// Aggregate public activity only: never count private bikes, drafts or hidden rides.
export async function siteStatistics(q) {
  return (
    await q.query(`SELECT
 (SELECT count(*)::int FROM users WHERE NOT blocked) users,
 (SELECT count(*)::int FROM bikes b JOIN users u ON u.id=b.owner_id WHERE b.is_public AND NOT u.blocked) bikes,
 (SELECT count(*)::int FROM rides r JOIN bikes b ON b.id=r.bike_id JOIN users u ON u.id=r.owner_id WHERE r.is_public AND b.is_public AND NOT u.blocked) rides,
 (SELECT coalesce(sum(r.distance_m),0)::bigint FROM rides r JOIN bikes b ON b.id=r.bike_id JOIN users u ON u.id=r.owner_id WHERE r.is_public AND b.is_public AND NOT u.blocked) distance,
 (SELECT count(*)::int FROM journal_entries e JOIN bikes b ON b.id=e.bike_id JOIN users u ON u.id=e.owner_id WHERE e.status='published' AND e.is_public AND b.is_public AND NOT u.blocked) entries`)
  ).rows[0];
}
