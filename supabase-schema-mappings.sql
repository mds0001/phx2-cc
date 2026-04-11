-- ============================================================
-- phx2 Mapping Profiles — run in the Supabase SQL Editor
-- ============================================================

-- ── Helper: updated_at trigger function ──────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── mapping_profiles ─────────────────────────────────────────
create table if not exists public.mapping_profiles (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  description    text,
  source_fields  jsonb not null default '[]',
  target_fields  jsonb not null default '[]',
  mappings       jsonb not null default '[]',
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.mapping_profiles enable row level security;

create policy "mappings: authenticated select" on public.mapping_profiles
  for select using (auth.role() = 'authenticated');

create policy "mappings: authenticated insert" on public.mapping_profiles
  for insert with check (auth.role() = 'authenticated');

create policy "mappings: update own or admin" on public.mapping_profiles
  for update using (
    created_by = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.user_type = 'admin'
    )
  );

create policy "mappings: delete own or admin" on public.mapping_profiles
  for delete using (
    created_by = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.user_type = 'admin'
    )
  );

drop trigger if exists set_mappings_updated_at on public.mapping_profiles;
create trigger set_mappings_updated_at
  before update on public.mapping_profiles
  for each row execute procedure public.set_updated_at();

-- ── Add mapping_profile_id to scheduled_tasks ────────────────
alter table public.scheduled_tasks
  add column if not exists mapping_profile_id uuid
  references public.mapping_profiles(id) on delete set null;
