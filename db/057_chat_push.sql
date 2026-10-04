-- #342 (N2.3): the messages of Stream conversations as pushes. A message is not
-- a notification: it has no row in the bell (Stream keeps what is unread), so
-- the queue of 056 gets a second source. A delivery is for an event of the bell
-- *or* for a message of a conversation, never both, and for a message it holds
-- references only (the conversation, the message, the author): no text, no
-- attachment, no copy of the conversation.
ALTER TABLE push_deliveries
 ALTER COLUMN notification_id DROP NOT NULL,
 ADD COLUMN chat_message_id text CHECK(chat_message_id ~ '^[A-Za-z0-9_.:-]{1,200}$'),
 ADD COLUMN chat_cid text CHECK(chat_cid ~ '^colabike:[A-Za-z0-9_-]{1,100}$'),
 ADD COLUMN chat_author_id uuid REFERENCES users(id) ON DELETE CASCADE,
 ADD CONSTRAINT push_deliveries_one_source CHECK(
  (notification_id IS NOT NULL AND chat_message_id IS NULL AND chat_cid IS NULL AND chat_author_id IS NULL)
  OR (notification_id IS NULL AND chat_message_id IS NOT NULL AND chat_cid IS NOT NULL AND chat_author_id IS NOT NULL));
-- One message to one device, ever, whoever delivers the webhook and however often.
CREATE UNIQUE INDEX push_deliveries_chat_once ON push_deliveries(chat_message_id,device_session_id) WHERE chat_message_id IS NOT NULL;
-- A newer message of a conversation replaces the older ones that have not left yet.
CREATE INDEX push_deliveries_chat_waiting ON push_deliveries(chat_cid,device_session_id) WHERE chat_cid IS NOT NULL AND status='pending';

ALTER TABLE push_deliveries DROP CONSTRAINT push_deliveries_error_code_check;
ALTER TABLE push_deliveries ADD CONSTRAINT push_deliveries_error_code_check
 CHECK(error_code IN ('expired','unavailable','preferences','muted','paused','quiet','disabled','rebound','revoked','invalid_token','rejected','provider_temporary','provider_auth','attempts_exhausted','superseded','gone','read','not_member'));

-- X-Webhook-Id of Stream: the same for every retry of one call. The table is only
-- the memory of "this was already taken"; the durable work is in push_deliveries.
CREATE TABLE chat_webhooks(
 webhook_id text PRIMARY KEY CHECK(length(webhook_id) BETWEEN 1 AND 100),
 received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chat_webhooks_old ON chat_webhooks(received_at);
