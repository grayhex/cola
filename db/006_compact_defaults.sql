UPDATE site_settings SET value=jsonb_set(value,'{showMileage}','false'),version=version+1 WHERE id=1;
UPDATE site_settings SET value=jsonb_set(value,'{detailBlocks}',(
 SELECT jsonb_agg(CASE WHEN b->>'id'='summary' THEN b || '{"enabled":false}'::jsonb ELSE b END ORDER BY n)
 FROM jsonb_array_elements(value->'detailBlocks') WITH ORDINALITY AS blocks(b,n)
)) WHERE id=1 AND jsonb_typeof(value->'detailBlocks')='array' AND jsonb_array_length(value->'detailBlocks')>0;
