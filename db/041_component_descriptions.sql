-- #264: a short public description of a catalog model, shown on its page and
-- edited by administrators with the rest of the model. Plain text.
ALTER TABLE component_models ADD COLUMN description text NOT NULL DEFAULT ''
 CHECK(char_length(description)<=2000);
