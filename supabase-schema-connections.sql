-- ============================================================
-- phx2 Endpoint Connections — run in the Supabase SQL Editor
-- ============================================================

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.endpoint_connections (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  type        text not null check (type in ('file','cloud','smtp','odbc','portal')),
  config      jsonb not null default '{}',
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.endpoint_connections enable row level security;

create policy "connections: authenticated select" on public.endpoint_connections
  for select using (auth.role() = 'authenticated');

create policy "connections: authenticated insert" on public.endpoint_connections
  for insert with check (auth.role() = 'authenticated');

create policy "connections: update own or admin" on public.endpoint_connections
  for update using (
    created_by = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.user_type = 'admin'
    )
  );

create policy "connections: delete own or admin" on public.endpoint_connections
  for delete using (
    created_by = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.user_type = 'admin'
    )
  );

drop trigger if exists set_connections_updated_at on public.endpoint_connections;
create trigger set_connections_updated_at
  before update on public.endpoint_connections
  for each row execute procedure public.set_updated_at();
