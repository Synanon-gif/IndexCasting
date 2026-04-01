-- =============================================================================
-- Security Events Logging Table
--
-- Records security-relevant rejections from the application layer:
--   - XSS attempts
--   - Invalid / unsafe URLs
--   - File upload rejections (MIME, magic bytes, extension)
--   - Rate limit violations
--   - Large payload attacks
--
-- Access model:
--   - INSERT: any authenticated user (only their own events via RLS)
--   - SELECT: blocked for all authenticated users (admin/service-role only)
--
-- This table is append-only from the application; no UPDATE or DELETE
-- for regular users — preserving the integrity of the audit log.
-- =============================================================================


-- ─── 1. Table ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.security_events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  org_id      UUID        REFERENCES public.organizations(id) ON DELETE SET NULL,
  type        TEXT        NOT NULL,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for admin queries: filter by user, org, type, or time range
CREATE INDEX IF NOT EXISTS security_events_user_id_idx    ON public.security_events (user_id);
CREATE INDEX IF NOT EXISTS security_events_org_id_idx     ON public.security_events (org_id);
CREATE INDEX IF NOT EXISTS security_events_type_idx       ON public.security_events (type);
CREATE INDEX IF NOT EXISTS security_events_created_at_idx ON public.security_events (created_at DESC);

-- Enforce allowed event types
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_schema = 'public'
      AND constraint_name = 'security_events_type_check'
  ) THEN
    ALTER TABLE public.security_events
      ADD CONSTRAINT security_events_type_check
        CHECK (type IN (
          'xss_attempt',
          'invalid_url',
          'file_rejected',
          'mime_mismatch',
          'extension_mismatch',
          'rate_limit',
          'large_payload',
          'magic_bytes_fail',
          'unsafe_content'
        ));
  END IF;
END;
$$;


-- ─── 2. Row Level Security ────────────────────────────────────────────────────

ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;

-- Authenticated users may insert their own events only
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'security_events'
      AND policyname = 'security_events_insert_own'
  ) THEN
    CREATE POLICY security_events_insert_own
      ON public.security_events
      FOR INSERT
      TO authenticated
      WITH CHECK (user_id = auth.uid());
  END IF;
END;
$$;

-- No SELECT policy for authenticated users — only service_role can read
-- (Supabase service_role bypasses RLS by default)


-- ─── 3. Verification ─────────────────────────────────────────────────────────

SELECT
  tablename,
  policyname,
  cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename  = 'security_events'
ORDER BY policyname;
