-- ============================================================
-- Migration: Add "basic" role (read-only users)
-- Run this in the Supabase SQL Editor for your project.
-- ============================================================

-- ── 1. Widen the user_type constraint to include 'basic' ─────
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_user_type_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_user_type_check
    CHECK (user_type IN ('admin', 'user', 'basic'));

-- ── 2. Widen the role constraint to include 'basic' ──────────
--    (only needed if a check constraint exists on the role column)
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
    CHECK (role IN ('administrator', 'schedule_administrator', 'basic'));

-- ── 3. Update the auto-signup trigger ────────────────────────
--    New self-signups land as role='basic' / user_type='basic'
--    so admins can review them before granting write access.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, first_name, last_name, email, role, user_type)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data ->> 'first_name',
    NEW.raw_user_meta_data ->> 'last_name',
    NEW.email,
    'basic',
    'basic'
  )
  ON CONFLICT (id) DO NOTHING;   -- invited users already have a profile row
  RETURN NEW;
END;
$$;

-- ── 4. Lock down write operations for basic users ────────────

-- scheduled_tasks: basic users can read but not insert/update/delete
DROP POLICY IF EXISTS "tasks: authenticated insert" ON public.scheduled_tasks;
CREATE POLICY "tasks: authenticated insert" ON public.scheduled_tasks
  FOR INSERT WITH CHECK (
    auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.user_type <> 'basic'
    )
  );

DROP POLICY IF EXISTS "tasks: update own or admin" ON public.scheduled_tasks;
CREATE POLICY "tasks: update own or admin" ON public.scheduled_tasks
  FOR UPDATE USING (
    (created_by = auth.uid() OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.user_type = 'admin'
    ))
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.user_type <> 'basic'
    )
  );

DROP POLICY IF EXISTS "tasks: delete own or admin" ON public.scheduled_tasks;
CREATE POLICY "tasks: delete own or admin" ON public.scheduled_tasks
  FOR DELETE USING (
    (created_by = auth.uid() OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.user_type = 'admin'
    ))
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.user_type <> 'basic'
    )
  );

-- mapping_profiles: same pattern (add basic exclusion to write policies)
-- NOTE: Adjust policy names below if yours differ from defaults.
DROP POLICY IF EXISTS "mappings: authenticated insert" ON public.mapping_profiles;
CREATE POLICY "mappings: authenticated insert" ON public.mapping_profiles
  FOR INSERT WITH CHECK (
    auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.user_type <> 'basic'
    )
  );

DROP POLICY IF EXISTS "mappings: update own or admin" ON public.mapping_profiles;
CREATE POLICY "mappings: update own or admin" ON public.mapping_profiles
  FOR UPDATE USING (
    (created_by = auth.uid() OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.user_type = 'admin'
    ))
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.user_type <> 'basic'
    )
  );

DROP POLICY IF EXISTS "mappings: delete own or admin" ON public.mapping_profiles;
CREATE POLICY "mappings: delete own or admin" ON public.mapping_profiles
  FOR DELETE USING (
    (created_by = auth.uid() OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.user_type = 'admin'
    ))
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.user_type <> 'basic'
    )
  );

-- endpoint_connections: same pattern
DROP POLICY IF EXISTS "connections: authenticated insert" ON public.endpoint_connections;
CREATE POLICY "connections: authenticated insert" ON public.endpoint_connections
  FOR INSERT WITH CHECK (
    auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.user_type <> 'basic'
    )
  );

DROP POLICY IF EXISTS "connections: update own or admin" ON public.endpoint_connections;
CREATE POLICY "connections: update own or admin" ON public.endpoint_connections
  FOR UPDATE USING (
    (created_by = auth.uid() OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.user_type = 'admin'
    ))
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.user_type <> 'basic'
    )
  );

DROP POLICY IF EXISTS "connections: delete own or admin" ON public.endpoint_connections;
CREATE POLICY "connections: delete own or admin" ON public.endpoint_connections
  FOR DELETE USING (
    (created_by = auth.uid() OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.user_type = 'admin'
    ))
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.user_type <> 'basic'
    )
  );
