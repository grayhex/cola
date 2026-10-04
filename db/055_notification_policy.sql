-- #341 (N1.2): the policy that decides which events reach a person, when and
-- through which channel. Settings live in notification_settings (054), the
-- rest below.

-- A group is what one author does to one object in one quarter of an hour: the
-- comments of a thread, say. It is not the identity of an event. The first
-- notice of a group keeps the old dedup_key (the group's own key), a later
-- event of a group whose newest notice was already read gets a notice of its
-- own (key = group + event id), and one that is still unread is folded into
-- that notice (it points at the newest comment). NULL on older rows: their
-- dedup_key is their group.
ALTER TABLE notifications ADD COLUMN group_key text;
CREATE INDEX notifications_group ON notifications(recipient_id,group_key,created_at DESC,id) WHERE group_key IS NOT NULL;
