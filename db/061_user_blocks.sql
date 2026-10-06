-- Blocking of a person by a person (#354). The row is the blocker's own list:
-- who they chose not to see. Effects are read from it where they happen
-- (follows, notices, direct messages, search and feeds); nothing is copied.
CREATE TABLE user_blocks (
 blocker_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 blocked_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (blocker_id, blocked_id),
 CHECK (blocker_id <> blocked_id)
);
-- "Who blocked this person": the other direction of every pair check.
CREATE INDEX user_blocks_blocked ON user_blocks (blocked_id, blocker_id);
-- The list of the blocker, newest first, for the keyset page.
CREATE INDEX user_blocks_list ON user_blocks (blocker_id, created_at DESC, blocked_id DESC);

-- The same block in Stream, made by a worker (scripts/chat-sync.js) so that a
-- vendor outage never fails a block on ColaBike. One row per pair: the last
-- intention wins. A deleted account takes its jobs with it.
CREATE TABLE chat_block_jobs (
 blocker_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 blocked_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 op text NOT NULL CHECK (op IN ('block','unblock')),
 attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY (blocker_id, blocked_id)
);
CREATE INDEX chat_block_jobs_due ON chat_block_jobs (next_attempt_at);
