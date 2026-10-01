-- Pick the approved library image when available; never replace an explicit
-- administrator choice. Media uploads keep their original display name.
UPDATE site_settings s SET value = s.value || jsonb_build_object(
  'heroBackgroundImageId', (SELECT id::text FROM site_assets
    WHERE lower(name)='new_hero1.png' AND filename LIKE '%.webp'
    ORDER BY created_at DESC,id LIMIT 1)
), version=version+1, updated_at=now()
WHERE s.id=1 AND NOT (s.value ? 'heroBackgroundImageId')
  AND EXISTS(SELECT 1 FROM site_assets WHERE lower(name)='new_hero1.png' AND filename LIKE '%.webp');

-- Migrate only the former default copy; retain customized headlines.
UPDATE site_settings SET value = value || jsonb_build_object(
 'heroHeadline', E'Новые дороги.\nНастоящие люди.'
), version=version+1, updated_at=now()
WHERE id=1 AND value->>'heroHeadline'=E'Покажи свой велосипед.\nРасскажи, как он меняется.';

UPDATE site_settings SET value = value || jsonb_build_object(
 'heroDescription', 'ColaBike — это сообщество, маршруты, знания и вдохновение. Здесь велосипед объединяет людей и помогает открывать новые места.'
), version=version+1, updated_at=now()
WHERE id=1 AND value->>'heroDescription'='Велосипеды, сборки, истории и покатушки людей, которым есть что показать.';
