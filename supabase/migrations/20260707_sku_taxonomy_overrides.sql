-- Per-customer SKU taxonomy overrides (South Star Bank).
--
-- A sparse, customer-scoped overlay on the global `sku_taxonomy` row: any
-- non-null classification field replaces the global value for that customer.
-- `ignore` is tri-state: null = inherit the global ignore flag, true = ignore
-- this SKU for the customer, false = force-include even when the global row is
-- ignored. Two-step approval: a schedule_administrator creates a `pending`
-- override; an administrator activates it to `active`. Pending/disabled rows
-- never affect runs.
create table if not exists public.sku_taxonomy_overrides (
  id               uuid primary key default gen_random_uuid(),
  customer_id      uuid not null references public.customers(id) on delete cascade,
  manufacturer_sku text not null,

  -- Sparse classification overrides (null = inherit the global sku_taxonomy value).
  manufacturer  text,
  type          text,
  subtype       text,
  description   text,
  model         text,
  -- Software product identity (mirrors the sw_* fields added for entitlement hydration).
  sw_title      text,
  sw_version    text,
  sw_edition    text,
  -- Tri-state ignore: null = inherit / true = customer-ignore / false = force-include.
  ignore        boolean,

  status          text not null default 'pending'
                    check (status in ('pending', 'active', 'disabled')),
  reason          text not null,
  -- Snapshot of the global row's classification fields captured at create time,
  -- so the drift report can flag Redundant / Stale / Orphaned overrides.
  global_snapshot jsonb,

  created_by    uuid,
  activated_by  uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (customer_id, manufacturer_sku)
);

create index if not exists sku_taxonomy_overrides_lookup_idx
  on public.sku_taxonomy_overrides (manufacturer_sku, customer_id, status);

-- Data API grants (new public tables are invisible to supabase-js without these).
grant select, insert, update, delete on table public.sku_taxonomy_overrides to anon, authenticated;
grant all on table public.sku_taxonomy_overrides to service_role;

-- RLS: reads open to authenticated users (the UI filters by the active customer;
-- runs resolve via the service-role API). All writes flow through the service-role
-- override API, which enforces the create-pending / activate approval workflow.
alter table public.sku_taxonomy_overrides enable row level security;
create policy "overrides: authenticated read"
  on public.sku_taxonomy_overrides
  for select
  using (auth.role() = 'authenticated');

-- Reuse the existing updated_at trigger function from sku_taxonomy.
create trigger sku_taxonomy_overrides_updated_at
  before update on public.sku_taxonomy_overrides
  for each row execute function set_sku_taxonomy_updated_at();
