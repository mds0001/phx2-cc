-- ============================================================
-- phx2 Supabase Schema — run in the Supabase SQL Editor
-- ============================================================

-- ── profiles ────────────────────────────────────────────────
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  first_name  text,
  last_name   text,
  email       text,
  user_type   text not null default 'user' check (user_type in ('admin', 'user')),
  avatar_url  text,
  created_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: select own" on public.profiles
  for select using (auth.uid() = id);

create policy "profiles: update own" on public.profiles
  for update using (auth.uid() = id);

create policy "profiles: insert own" on public.profiles
  for insert with check (auth.uid() = id);

create policy "profiles: admin select all" on public.profiles
  for select using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.user_type = 'admin'
    )
  );

-- ── Auto-create profile on signup ───────────────────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, first_name, last_name, email, user_type)
  values (
    new.id,
    new.raw_user_meta_data ->> 'first_name',
    new.raw_user_meta_data ->> 'last_name',
    new.email,
    'user'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ── scheduled_tasks ─────────────────────────────────────────
create table if not exists public.scheduled_tasks (
  id              uuid primary key default gen_random_uuid(),
  task_name       text not null,
  start_date_time timestamptz not null,
  end_date_time   timestamptz,
  recurrence      text not null default 'one-time'
    check (recurrence in ('one-time','daily','weekly','monthly')),
  rule_type       text not null
    check (rule_type in ('Contact Members','Data Transfer','Ivanti CI Sync')),
  source_file_path text,
  ivanti_url      text,
  status          text not null default 'waiting'
    check (status in ('waiting','active','completed','cancelled')),
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.scheduled_tasks enable row level security;

create policy "tasks: authenticated select" on public.scheduled_tasks
  for select using (auth.role() = 'authenticated');

create policy "tasks: authenticated insert" on public.scheduled_tasks
  for insert with check (auth.role() = 'authenticated');

create policy "tasks: update own or admin" on public.scheduled_tasks
  for update using (
    created_by = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.user_type = 'admin'
    )
  );

create policy "tasks: delete own or admin" on public.scheduled_tasks
  for delete using (
    created_by = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.user_type = 'admin'
    )
  );

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_tasks_updated_at on public.scheduled_tasks;
create trigger set_tasks_updated_at
  before update on public.scheduled_tasks
  for each row execute procedure public.set_updated_at();

alter publication supabase_realtime add table public.scheduled_tasks;

-- ── task_logs ────────────────────────────────────────────────
create table if not exists public.task_logs (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.scheduled_tasks(id) on delete cascade,
  action     text not null,
  details    text,
  created_at timestamptz not null default now()
);

alter table public.task_logs enable row level security;

create policy "logs: authenticated select" on public.task_logs
  for select using (auth.role() = 'authenticated');

create policy "logs: authenticated insert" on public.task_logs
  for insert with check (auth.role() = 'authenticated');

create policy "logs: authenticated delete" on public.task_logs
  for delete using (auth.role() = 'authenticated');

-- ── Storage Buckets ──────────────────────────────────────────
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true)
  on conflict (id) do nothing;

insert into storage.buckets (id, name, public) values ('task_files', 'task_files', false)
  on conflict (id) do nothing;

create policy "avatars: public read" on storage.objects
  for select using (bucket_id = 'avatars');

create policy "avatars: auth upload" on storage.objects
  for insert with check (bucket_id = 'avatars' and auth.role() = 'authenticated');

create policy "avatars: auth update" on storage.objects
  for update using (bucket_id = 'avatars' and auth.role() = 'authenticated');

create policy "task_files: auth read" on storage.objects
  for select using (bucket_id = 'task_files' and auth.role() = 'authenticated');

create policy "task_files: auth upload" on storage.objects
  for insert with check (bucket_id = 'task_files' and auth.role() = 'authenticated');
