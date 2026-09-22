-- Ownership history is independent of classification and publication.
ALTER TABLE bikes ADD COLUMN is_former boolean NOT NULL DEFAULT false;

-- Listing intent is independent of the physical item category.
ALTER TABLE market_listings ADD COLUMN listing_type text NOT NULL DEFAULT 'sale'
  CHECK (listing_type IN ('sale','wanted','exchange','free'));
ALTER TABLE market_listings ALTER COLUMN price DROP NOT NULL;
ALTER TABLE market_listings ALTER COLUMN currency SET DEFAULT 'RUB';
ALTER TABLE market_listings ADD CONSTRAINT market_free_price
  CHECK (listing_type <> 'free' OR (price IS NOT NULL AND price = 0 AND currency = 'RUB'));
CREATE INDEX market_listing_type_publication
  ON market_listings(listing_type,published_at DESC,id) WHERE status='active';
-- Do not relabel historical foreign-currency amounts as rubles, seed content,
-- delete old rides or alter any applied migration history.
