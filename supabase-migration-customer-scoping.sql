-- ============================================================
-- Migration: Customer scoping for tasks, mappings, connections
-- ============================================================

-- ── 1. Add customer_id to scheduled_tasks ───────────────────
ALTER TABLE public.scheduled_tasks
  ADD COLUMN IF NOT EXISTS customer_id UUID
    REFERENCES public.customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_customer_id
  ON public.scheduled_tasks(customer_id);

-- ── 2. Add customer_id to mapping_profiles ──────────────────
ALTER TABLE public.mapping_profiles
  ADD COLUMN IF NOT EXISTS customer_id UUID
    REFERENCES public.customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_mapping_profiles_customer_id
  ON public.mapping_profiles(customer_id);

-- ── 3. Add customer_id to endpoint_connections ──────────────
ALTER TABLE public.endpoint_connections
  ADD COLUMN IF NOT EXISTS customer_id UUID
    REFERENCES public.customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_endpoint_connections_customer_id
  ON public.endpoint_connections(customer_id);

-- ── 4. RLS: update SELECT policies to allow customer-scoped reads ─
-- (Existing SELECT policies allow all authenticated users — no change
--  needed. Filtering is done at the query level in the app.)
