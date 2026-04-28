-- Add 'insight' to endpoint_connections type constraint
alter table public.endpoint_connections
  drop constraint if exists endpoint_connections_type_check;

alter table public.endpoint_connections
  add constraint endpoint_connections_type_check
  check (type in (
    'file','cloud','smtp','odbc','portal',
    'ivanti','ivanti_neurons','dell','cdw','azure','insight'
  ));

-- Add insight_steps JSONB column to scheduled_tasks
alter table public.scheduled_tasks
  add column if not exists insight_steps jsonb;
