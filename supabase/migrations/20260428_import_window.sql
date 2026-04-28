-- Add import window (date range) to scheduled_tasks
-- Used by Insight / Dell / CDW source connections to scope the data pull.

ALTER TABLE scheduled_tasks
  ADD COLUMN IF NOT EXISTS import_window_start date,
  ADD COLUMN IF NOT EXISTS import_window_end   date;

COMMENT ON COLUMN scheduled_tasks.import_window_start IS 'Inclusive start date for vendor API import window (Insight, Dell, CDW). NULL = use connection default / lookback.';
COMMENT ON COLUMN scheduled_tasks.import_window_end   IS 'Inclusive end date for vendor API import window (Insight, Dell, CDW). NULL = use connection default / yesterday.';
