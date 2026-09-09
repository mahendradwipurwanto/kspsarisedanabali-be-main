-- The Daftar Dokumen block's "category" was one string: '' or 'all' for every
-- kind, else a slug. It is a list of slugs now, and an empty list means every
-- kind, so a page saved before this would otherwise fail validation the next
-- time anyone touched it.
UPDATE "page_blocks"
SET "props" = jsonb_set("props", '{category}',
  CASE
    WHEN jsonb_typeof("props"->'category') = 'array' THEN "props"->'category'
    WHEN coalesce("props"->>'category', '') IN ('', 'all') THEN '[]'::jsonb
    ELSE jsonb_build_array("props"->'category')
  END, true)
WHERE "type" = 'document_list';
