-- ── Pipeline: leads & opportunities ─────────────────────────────────────────

-- leads
create table if not exists public.leads (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  email          text,
  company        text,
  phone          text,
  tier_interest  text check (tier_interest in ('free','pro','master')),
  source         text check (source in ('website','referral','cold','event','other')),
  status         text not null default 'new' check (status in ('new','contacted','qualified','disqualified')),
  notes          text,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- opportunities
create table if not exists public.opportunities (
  id                    uuid primary key default gen_random_uuid(),
  lead_id               uuid references public.leads(id) on delete cascade,
  tier                  text check (tier in ('free','pro','master')),
  estimated_close_date  date,
  status                text not null default 'active' check (status in ('active','won','lost')),
  notes                 text,
  created_by            uuid references auth.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- updated_at triggers
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger leads_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

create trigger opportunities_updated_at
  before update on public.opportunities
  for each row execute function public.set_updated_at();

-- RLS
alter table public.leads         enable row level security;
alter table public.opportunities enable row level security;

-- Admin-only (mirrors existing BOH tables)
create policy "admins_all_leads" on public.leads
  for all using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'administrator'
    )
  );

create policy "admins_all_opportunities" on public.opportunities
  for all using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'administrator'
    )
  );
