-- #236: a scheduled notice is the same social event as its eventual email.
ALTER TABLE notification_email_preferences ADD COLUMN ride_reminders boolean NOT NULL DEFAULT true;
ALTER TABLE notifications ADD COLUMN event_occurs_at timestamptz;
ALTER TABLE notifications ADD COLUMN event_revision integer CHECK(event_revision>=1);
ALTER TABLE notifications ADD COLUMN deliver_after timestamptz NOT NULL DEFAULT now();
ALTER TABLE notifications ADD COLUMN released_at timestamptz;
ALTER TABLE notifications ADD COLUMN cancelled_at timestamptz;
CREATE INDEX ride_notification_schedule ON notifications(deliver_after,id) WHERE type='ride_reminder' AND released_at IS NULL AND cancelled_at IS NULL;
CREATE INDEX ride_notification_event ON notifications(ride_id,recipient_id,event_occurs_at,event_revision,type);

-- Preserve each old type/target invariant; new ride notices get their own shape.
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid='notifications'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%type%' LOOP
  EXECUTE format('ALTER TABLE notifications DROP CONSTRAINT %I',c.conname);
  EXECUTE format('ALTER TABLE notifications ADD CONSTRAINT %I CHECK((%s) OR type IN (''ride_changed'',''ride_cancelled'',''ride_response'',''ride_reminder''))',c.conname,substring(c.definition FROM 8 FOR length(c.definition)-8));
 END LOOP;
END $$;
ALTER TABLE notifications ADD CHECK(type NOT IN ('ride_changed','ride_cancelled','ride_response','ride_reminder') OR (
 ride_id IS NOT NULL AND event_occurs_at IS NOT NULL AND event_revision IS NOT NULL
 AND bike_id IS NULL AND comment_id IS NULL AND ride_comment_id IS NULL AND entry_id IS NULL AND entry_comment_id IS NULL
 AND component_id IS NULL AND component_comment_id IS NULL AND listing_id IS NULL
));

-- A legacy invitation has no occurrence/revision; do not reinterpret its queued email.
UPDATE notification_email_outbox o SET status='skipped',error_code='unavailable',finished_at=now(),lease_token=NULL,lease_until=NULL
 FROM notifications n WHERE n.id=o.notification_id AND n.type='ride_invite' AND o.status IN ('pending','sending');

-- Existing three-argument callers keep the defaults. New consumers can set a
-- coalescing delay and the occurrence's delivery deadline, using this same queue.
DROP FUNCTION cola_queue_notification_email(uuid,uuid,text);
CREATE FUNCTION cola_queue_notification_email(event_id uuid,recipient uuid,category text,
 delivery_at timestamptz DEFAULT now(),deadline timestamptz DEFAULT now()+interval '7 days') RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE inserted integer;
BEGIN
 IF category IS NULL OR category NOT IN ('discussions','rides','market') OR deadline<=now() THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM notification_email_outbox WHERE notification_id=event_id) THEN RETURN false; END IF;
 UPDATE notification_email_preferences p SET queued_count=p.queued_count+1
 WHERE p.user_id=recipient AND p.enabled AND p.queued_count<100
   AND CASE category WHEN 'discussions' THEN p.discussions WHEN 'rides' THEN p.rides WHEN 'market' THEN p.market ELSE false END
   AND EXISTS(SELECT 1 FROM users u WHERE u.id=recipient AND NOT u.blocked AND u.email_verified_at IS NOT NULL);
 IF NOT FOUND THEN RETURN false; END IF;
 INSERT INTO notification_email_outbox(notification_id,recipient_id,available_at,expires_at)
 VALUES(event_id,recipient,greatest(now(),delivery_at),least(deadline,greatest(now(),delivery_at)+interval '7 days')) ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS inserted = ROW_COUNT;
 IF inserted=0 THEN UPDATE notification_email_preferences SET queued_count=queued_count-1 WHERE user_id=recipient; END IF;
 RETURN inserted=1;
END $$;
