-- Add ignore flag to sku_taxonomy
-- When true, rows with this SKU are silently skipped during import runs.
ALTER TABLE sku_taxonomy
  ADD COLUMN IF NOT EXISTS ignore boolean NOT NULL DEFAULT false;
