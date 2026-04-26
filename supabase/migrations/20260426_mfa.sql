-- ============================================================
-- MFA (Email OTP) Support
-- Run this in Supabase: Dashboard → SQL Editor → New query
-- ============================================================

-- 1. Add mfa_enabled flag to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT false;

-- 2. MFA challenge table — stores in-flight OTP hashes
CREATE TABLE IF NOT EXISTS mfa_challenges (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL,
  otp_hash   TEXT        NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT fk_mfa_challenges_user
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Index for fast lookup by user
CREATE INDEX IF NOT EXISTS idx_mfa_challenges_user_id
  ON mfa_challenges(user_id);

-- Row-Level Security — only the service role (API routes) can read/write
ALTER TABLE mfa_challenges ENABLE ROW LEVEL SECURITY;

-- No user-facing RLS policies — service role bypasses RLS entirely.
-- Drop any accidental public policies:
DROP POLICY IF EXISTS "mfa_challenges_public" ON mfa_challenges;

-- 3. Cleanup function — called by a cron job or on-demand to remove expired challenges
CREATE OR REPLACE FUNCTION cleanup_expired_mfa_challenges()
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  DELETE FROM mfa_challenges
  WHERE expires_at < now() - INTERVAL '1 hour';
$$;
