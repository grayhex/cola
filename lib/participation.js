import { randomUUID } from "node:crypto";
// Transactional, daily pseudonymous counters. No content, target, IP or email.
export async function participation(q, user, event) {
  await q.query(
    "INSERT INTO participation_actors(user_id,actor_key) VALUES($1,$2) ON CONFLICT DO NOTHING",
    [user, randomUUID()],
  );
  await q.query(
    `INSERT INTO participation_events(actor_key,event) SELECT actor_key,$2 FROM participation_actors WHERE user_id=$1
    ON CONFLICT(actor_key,day,event) DO UPDATE SET amount=participation_events.amount+1`,
    [user, event],
  );
}
export async function participationSummary(q) {
  return (
    await q.query(`SELECT event,sum(amount)::int actions,count(DISTINCT actor_key)::int participants,
    count(*) FILTER(WHERE days>1)::int returning_participants FROM (
    SELECT event,actor_key,sum(amount) amount,count(DISTINCT day) days FROM participation_events
    WHERE day>=current_date-30 GROUP BY event,actor_key) s GROUP BY event ORDER BY event`)
  ).rows;
}
