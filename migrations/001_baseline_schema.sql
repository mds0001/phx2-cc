-- =============================================================================
-- Migration 001: Baseline Schema
-- Project: Threads by Cloud Weaver (PHX2)
-- Date: 2026-04-18
-- Description: Documents the full schema as it exists at project baseline.
--              This is a reference migration — the schema already exists in
--              production. Do NOT re-run this on an existing database.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- TABLE: customers
-- Stores customer (client) records. Central entity for BOH management.
-- ---------------------------------------------------------------------------
CREATE TABLE public.customers (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL,
  company               text,
  email                 text,
  phone                 text,
  billing_street        text,
  billing_city          text,
  billing_state         text,
  billing_zip           text,
  billing_country       text DEFAULT 'US',
  card_type             text,
  card_last4            text,
  card_expiry_month     integer,
  card_expiry_year      integer,
  payment_processor_ref text,
  po_terms              text,
  payment_status        text NOT NULL DEFAULT 'active'
                          CHECK (payment_status IN ('active','lapsed','failed','pending')),
  alert_days_before     integer NOT NULL DEFAULT 30,
  notes                 text,
  created_by            uuid REFERENCES auth.users(id),
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;


-- ---------------------------------------------------------------------------
-- TABLE: profiles
-- One row per auth.users entry. Extends user with role and customer scoping.
-- ---------------------------------------------------------------------------
CREATE TABLE public.profiles (
  id          uuid PRIMARY KEY REFERENCES auth.users(id),
  first_name  text,
  last_name   text,
  email       text,
  avatar_url  text,
  user_type   text NOT NULL DEFAULT 'user'
                CHECK (user_type IN ('admin','user','basic')),
  role        text NOT NULL DEFAULT 'schedule_administrator'
                CHECK (role IN ('administrator','schedule_administrator','basic')),
  customer_id uuid REFERENCES public.customers(id),
  -- For schedule_administrator role: scopes the user to a single customer.
  -- NULL = unscoped (admins always see everything regardless of this value).
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;


-- ---------------------------------------------------------------------------
-- TABLE: license_types
-- Product catalog — defines what can be sold to customers.
-- ---------------------------------------------------------------------------
CREATE TABLE public.license_types (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                      text NOT NULL,
  description               text,
  type                      text NOT NULL
                              CHECK (type IN ('one_time','subscription','by_endpoint')),
  price_cents               integer NOT NULL DEFAULT 0,
  renewal_notification_days integer NOT NULL DEFAULT 30,
  endpoint_type             text,   -- Only set when type = by_endpoint
  default_executions        integer, -- Only relevant when type = one_time
  start_date                date,   -- Subscription validity start
  end_date                  date,   -- Subscription validity end
  created_by                uuid REFERENCES auth.users(id),
  created_at                timestamptz DEFAULT now(),
  updated_at                timestamptz DEFAULT now()
);
ALTER TABLE public.license_types ENABLE ROW LEVEL SECURITY;


-- ---------------------------------------------------------------------------
-- TABLE: customer_licenses
-- Assigns a license_type to a customer with runtime tracking.
-- ---------------------------------------------------------------------------
CREATE TABLE public.customer_licenses (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id      uuid NOT NULL REFERENCES public.customers(id),
  license_type_id  uuid REFERENCES public.license_types(id),
  product_name     text NOT NULL,
  license_key      text,
  seats            integer NOT NULL DEFAULT 1,
  start_date       date,
  expiry_date      date,
  status           text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','trial','expired','cancelled')),
  renewal_type     text NOT NULL DEFAULT 'manual'
                     CHECK (renewal_type IN ('auto','manual')),
  max_executions   integer, -- Total executions purchased (one_time only)
  executions_used  integer NOT NULL DEFAULT 0, -- Executions consumed (one_time only)
  notes            text,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);
ALTER TABLE public.customer_licenses ENABLE ROW LEVEL SECURITY;


-- ---------------------------------------------------------------------------
-- TABLE: endpoint_connections
-- Stores connection configs for all source/target integrations.
-- ---------------------------------------------------------------------------
CREATE TABLE public.endpoint_connections (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  type        text NOT NULL
                CHECK (type IN ('file','cloud','smtp','odbc','portal','ivanti',
                                'ivanti_neurons','dell','cdw','azure')),
  config      jsonb NOT NULL DEFAULT '{}',
  customer_id uuid REFERENCES public.customers(id),
  created_by  uuid REFERENCES auth.users(id),
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);
ALTER TABLE public.endpoint_connections ENABLE ROW LEVEL SECURITY;


-- ---------------------------------------------------------------------------
-- TABLE: mapping_profiles
-- Field mapping configurations — maps source Excel fields to target fields.
-- ---------------------------------------------------------------------------
CREATE TABLE public.mapping_profiles (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    text NOT NULL,
  description             text,
  source_fields           jsonb NOT NULL DEFAULT '[]',
  target_fields           jsonb NOT NULL DEFAULT '[]',
  mappings                jsonb NOT NULL DEFAULT '[]',
  zip_file_order          jsonb NOT NULL DEFAULT '[]',
  filter_expression       text,
  target_business_object  text,
  source_connection_id    uuid REFERENCES public.endpoint_connections(id),
  target_connection_id    uuid REFERENCES public.endpoint_connections(id),
  customer_id             uuid REFERENCES public.customers(id),
  created_by              uuid REFERENCES auth.users(id),
  created_at              timestamptz DEFAULT now(),
  updated_at              timestamptz DEFAULT now()
);
ALTER TABLE public.mapping_profiles ENABLE ROW LEVEL SECURITY;


-- ---------------------------------------------------------------------------
-- TABLE: rule_types
-- User-defined rule templates that combine source, target, and mapping.
-- ---------------------------------------------------------------------------
CREATE TABLE public.rule_types (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    text NOT NULL,
  description             text,
  icon_url                text,
  source_connection_id    uuid REFERENCES public.endpoint_connections(id),
  destination_connection_id uuid REFERENCES public.endpoint_connections(id),
  mapping_profile_id      uuid REFERENCES public.mapping_profiles(id),
  created_by              uuid REFERENCES public.profiles(id),
  created_at              timestamptz DEFAULT now(),
  updated_at              timestamptz DEFAULT now()
);
ALTER TABLE public.rule_types ENABLE ROW LEVEL SECURITY;


-- ---------------------------------------------------------------------------
-- TABLE: scheduled_tasks
-- Central entity — a task that runs on a schedule or on demand.
-- ---------------------------------------------------------------------------
CREATE TABLE public.scheduled_tasks (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_name             text NOT NULL,
  recurrence            text NOT NULL
                          CHECK (recurrence IN ('one-time','daily','weekly','monthly')),
  start_date_time       timestamptz NOT NULL,
  end_date_time         timestamptz,
  status                text NOT NULL DEFAULT 'active'
                          CHECK (status IN ('waiting','active','completed','cancelled')),
  write_mode            text NOT NULL DEFAULT 'upsert'
                          CHECK (write_mode IN ('upsert','create_only')),
  rule_type             text NOT NULL DEFAULT 'contact-members',
  rule_type_id          uuid REFERENCES public.rule_types(id),
  mapping_profile_id    uuid REFERENCES public.mapping_profiles(id),
  mapping_slots         jsonb NOT NULL DEFAULT '[]',
  source_connection_id  uuid REFERENCES public.endpoint_connections(id),
  target_connection_id  uuid REFERENCES public.endpoint_connections(id),
  source_type           text,
  destination_type      text,
  source_file_path      text,
  converted_file_path   text,
  ivanti_url            text,
  customer_id           uuid REFERENCES public.customers(id),
  created_by            uuid REFERENCES auth.users(id),
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);
ALTER TABLE public.scheduled_tasks ENABLE ROW LEVEL SECURITY;


-- ---------------------------------------------------------------------------
-- TABLE: task_logs
-- Audit log for task execution events (one row per action/step).
-- ---------------------------------------------------------------------------
CREATE TABLE public.task_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     uuid REFERENCES public.scheduled_tasks(id),
  action      text NOT NULL,
  details     text,
  created_by  uuid REFERENCES auth.users(id),
  created_at  timestamptz DEFAULT now()
);
ALTER TABLE public.task_logs ENABLE ROW LEVEL SECURITY;


-- ---------------------------------------------------------------------------
-- TABLE: logs
-- Generic system log table (separate from task_logs).
-- ---------------------------------------------------------------------------
CREATE TABLE public.logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  log_type    text NOT NULL,
  task_id     uuid REFERENCES public.scheduled_tasks(id),
  message     text NOT NULL,
  created_at  timestamptz DEFAULT now()
);
ALTER TABLE public.logs ENABLE ROW LEVEL SECURITY;


-- ---------------------------------------------------------------------------
-- TABLE: ai_lookup_cache
-- Caches Claude AI classification results to avoid redundant API calls.
-- ---------------------------------------------------------------------------
CREATE TABLE public.ai_lookup_cache (
  cache_key   text PRIMARY KEY,
  mode        text NOT NULL,
  result      text NOT NULL,
  hit_count   integer NOT NULL DEFAULT 1,
  created_at  timestamptz DEFAULT now(),
  last_used_at timestamptz DEFAULT now()
);
-- No RLS on this table (internal cache, no user data)
