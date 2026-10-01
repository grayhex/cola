-- #148: payload-free email delivery, explicit consent and a bounded per-user queue.
CREATE TABLE notification_email_preferences (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 enabled boolean NOT NULL DEFAULT false,
 discussions boolean NOT NULL DEFAULT false,
 rides boolean NOT NULL DEFAULT false,
 market boolean NOT NULL DEFAULT false,
 unsubscribe_key text NOT NULL DEFAULT (gen_random_uuid()::text || gen_random_uuid()::text),
 queued_count integer NOT NULL DEFAULT 0 CHECK (queued_count BETWEEN 0 AND 100),
 next_delivery_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX notifications_delivery_recipient ON notifications(id,recipient_id);
CREATE TABLE notification_email_outbox (
 notification_id uuid PRIMARY KEY,
 recipient_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 channel text NOT NULL DEFAULT 'email' CHECK (channel='email'),
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed','skipped')),
 attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 8),
 available_at timestamptz NOT NULL DEFAULT now(),
 lease_token uuid,
 lease_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days',
 finished_at timestamptz,
 error_code text CHECK (error_code IN ('expired','unavailable','preferences','rate_limit','smtp_temporary','smtp_permanent','attempts_exhausted')),
 FOREIGN KEY(notification_id,recipient_id) REFERENCES notifications(id,recipient_id) ON DELETE CASCADE
);
CREATE INDEX notification_email_due ON notification_email_outbox(available_at,recipient_id,notification_id) WHERE status IN ('pending','sending');
CREATE INDEX notification_email_history ON notification_email_outbox(finished_at) WHERE status IN ('sent','failed','skipped');

-- Called only for newly inserted events, in the same statement as the event.
-- The application passes a catalogue category, never message text or an address.
CREATE FUNCTION cola_queue_notification_email(event_id uuid, recipient uuid, category text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE inserted integer;
BEGIN
 IF category IS NULL OR category NOT IN ('discussions','rides','market') THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM notification_email_outbox WHERE notification_id=event_id) THEN RETURN false; END IF;
 UPDATE notification_email_preferences p SET queued_count=p.queued_count+1
 WHERE p.user_id=recipient AND p.enabled AND p.queued_count<100
   AND CASE category WHEN 'discussions' THEN p.discussions WHEN 'rides' THEN p.rides WHEN 'market' THEN p.market ELSE false END
   AND EXISTS(SELECT 1 FROM users u WHERE u.id=recipient AND NOT u.blocked AND u.email_verified_at IS NOT NULL);
 IF NOT FOUND THEN RETURN false; END IF;
 INSERT INTO notification_email_outbox(notification_id,recipient_id) VALUES(event_id,recipient) ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS inserted = ROW_COUNT;
 IF inserted=0 THEN
   UPDATE notification_email_preferences SET queued_count=queued_count-1 WHERE user_id=recipient;
 END IF;
 RETURN inserted=1;
END $$;

-- Cascaded event/account deletion and terminal outcomes release the budget too.
CREATE FUNCTION cola_release_notification_email() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status IN ('pending','sending') AND (TG_OP='DELETE' OR NEW.status NOT IN ('pending','sending')) THEN
   UPDATE notification_email_preferences SET queued_count=greatest(0,queued_count-1) WHERE user_id=OLD.recipient_id;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER notification_email_release AFTER UPDATE OF status OR DELETE ON notification_email_outbox FOR EACH ROW EXECUTE FUNCTION cola_release_notification_email();
