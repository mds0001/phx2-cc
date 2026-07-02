-- Software product identity on the taxonomy.
-- A license/subscription SKU is an ENTITLEMENT that references a canonical
-- software product; research populates that identity here, and the runner's
-- software hydration steps build CI#ivnt_SoftwareProduct records from it
-- (composed into ivnt_SWFullName, e.g. "Microsoft Windows 11 Pro").
-- Software lines are held at import until these fields are researched.
ALTER TABLE sku_taxonomy
  ADD COLUMN IF NOT EXISTS sw_title   text,
  ADD COLUMN IF NOT EXISTS sw_version text,
  ADD COLUMN IF NOT EXISTS sw_edition text;
