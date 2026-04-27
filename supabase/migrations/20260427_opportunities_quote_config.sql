-- ── Ensure opportunities has quote columns ────────────────────────────────────
alter table public.opportunities
  add column if not exists quote_config   jsonb,
  add column if not exists send_to_admin  boolean not null default false;

-- ── Ensure license_types has yearly_price_cents ───────────────────────────────
alter table public.license_types
  add column if not exists yearly_price_cents integer;

-- ── Allow admin users to read license_types ───────────────────────────────────
-- (RLS is enabled on license_types but had no select policy,
--  so only the service-role client could read it)
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'license_types'
      and policyname = 'admins_select_license_types'
  ) then
    execute $pol$
      create policy "admins_select_license_types" on public.license_types
        for select using (
          exists (
            select 1 from public.profiles
            where id = auth.uid() and role = 'administrator'
          )
        )
    $pol$;
  end if;
end $$;
