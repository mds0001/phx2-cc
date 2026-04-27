-- Add duration_days to license_types.
-- For subscription types this replaces the fixed start_date/end_date on the template
-- (those columns were meaningless per-customer; actual dates live on customer_licenses).
alter table public.license_types
  add column if not exists duration_days integer;

-- Backfill: set 365 for any existing subscription type that has no duration yet
update public.license_types
  set duration_days = 365
  where type = 'subscription' and duration_days is null;
