CREATE TABLE bike_follows (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 bike_id uuid NOT NULL REFERENCES bikes(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,bike_id)
);
CREATE INDEX bike_follows_bike ON bike_follows(bike_id);
CREATE TABLE journal_saves (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 entry_id uuid NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,entry_id)
);
CREATE INDEX journal_saves_page ON journal_saves(user_id,created_at DESC,entry_id);
ALTER TABLE journal_entries ADD COLUMN installation_result text CHECK(installation_result IN ('direct','modified','failed'));
ALTER TABLE journal_entries ADD COLUMN solution_id uuid REFERENCES journal_comments(id) ON DELETE SET NULL;
ALTER TABLE journal_entries ADD COLUMN participation_recorded boolean NOT NULL DEFAULT false;
ALTER TABLE bikes ADD COLUMN purposes text[] NOT NULL DEFAULT '{}';
-- No text, IP, user agent, target IDs or identity. A random actor key is used only
-- to aggregate repeat participation, never exposed publicly; deletion cascades.
CREATE TABLE participation_actors (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 actor_key uuid NOT NULL UNIQUE
);
CREATE TABLE participation_events (
 actor_key uuid NOT NULL REFERENCES participation_actors(actor_key) ON DELETE CASCADE,
 day date NOT NULL DEFAULT current_date,
 event text NOT NULL CHECK(event IN ('publish','follow','save')),
 amount integer NOT NULL DEFAULT 1,
 PRIMARY KEY(actor_key,day,event)
);
CREATE OR REPLACE FUNCTION experience_normalize(value text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT regexp_replace(lower(translate(coalesce(value,''),'ёЁ','ее')), '[^a-zа-я0-9]', '', 'g')
$$;
-- Alias rules are supplied from the existing managed site catalogue, not a
-- second catalogue. Longest variant first; canonical targets cannot be aliases.
CREATE OR REPLACE FUNCTION experience_canonical(value text, rules jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE result text := experience_normalize(value); rule jsonb;
BEGIN
 FOR rule IN SELECT v FROM jsonb_array_elements(rules) v ORDER BY length(experience_normalize(v->>'alias')) DESC LOOP
  result := replace(result, experience_normalize(rule->>'alias'), experience_normalize(rule->>'name'));
 END LOOP;
 RETURN result;
END $$;
CREATE INDEX journal_public_date ON journal_entries(published_at DESC,id) WHERE status='published' AND is_public;
CREATE OR REPLACE FUNCTION experience_rules(rules jsonb, scope text, scope_rules jsonb DEFAULT '[]') RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT coalesce(jsonb_agg(v),'[]'::jsonb) FROM jsonb_array_elements(rules) v
 WHERE coalesce(v->>'scope','')='' OR experience_canonical(v->>'scope',scope_rules)=experience_canonical(scope,scope_rules)
$$;
