-- Preserve every existing choice, including intentionally empty copy.
UPDATE site_settings SET value = value || jsonb_build_object(
  'heroEyebrow', 'Больше чем просто велосипеды'
), version=version+1, updated_at=now()
WHERE id=1 AND NOT (value ? 'heroEyebrow');
