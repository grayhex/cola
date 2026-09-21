ALTER TABLE rides ADD COLUMN IF NOT EXISTS public_speed_profile jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Retire the old appearance constructor. Uploaded files are left in the media
-- library; only obsolete assignments and personal styling choices are removed.
UPDATE site_settings SET value = value - ARRAY[
  'uiIcons','partIconAssets','designPreset','displayFont','theme','font','accent','radius',
  'headerArtworkFit','logoId','garageImageId','backgroundImageId','backgroundOpacity','backgroundMode',
  'navIconSize','navOrder','wizardLinkIconId','wizardManualIconId','loginImageId','registerImageId','aboutHistoryImageId',
  'navHomeIconId','navJournalIconId','navNewIconId','navPopularIconId','navRidesIconId','navAboutIconId',
  'navProfileIconId','navMessagesIconId','navSubscriptionsIconId','navRecordsIconId','navAdminIconId','navLogoutIconId',
  'addBikeIconId','searchIconId','likeIconId','mtbTypeIconId','roadTypeIconId','gravelTypeIconId'
], version = version + 1;
UPDATE users SET preferences = preferences - ARRAY['font','accent','theme'];
