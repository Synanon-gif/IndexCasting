-- =============================================================================
-- Migration: 20260413_audit_trail_source_column.sql
--
-- WHY: The audit_trail table had no way to distinguish HOW an action was
-- triggered. Enterprise-grade audit trails need:
--   source = 'api'     — direct frontend Supabase call (supabase.rpc / .from)
--   source = 'rpc'     — triggered via server-to-server or admin RPC
--   source = 'system'  — background job, cron, or automated process
--   source = 'trigger' — DB trigger (e.g. fn_auto_create_booking_event_on_confirm)
--
-- This enables:
--   - Debugging: "which code path created this audit entry?"
--   - Security: "was this action user-initiated or system-initiated?"
--   - Compliance: "all user-initiated actions are source='api'"
--
-- NOTE: user_id (= auth.uid()) IS the actor_id — no separate actor_id column
-- needed. user_id already captures WHO performed the action. source captures HOW.
--
-- ALSO FIXES: log_audit_action still uses `profiles.is_admin = TRUE` for the
-- admin check (identified as Risk 1 in rls-security-patterns.mdc). This migration
-- replaces it with `public.is_current_user_admin()` (SECURITY DEFINER, UUID+email).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE.
-- =============================================================================


-- ─── 1. Add source column to audit_trail ─────────────────────────────────────

ALTER TABLE public.audit_trail
  ADD COLUMN IF NOT EXISTS source TEXT
    DEFAULT 'api'
    CHECK (source IN ('api', 'rpc', 'system', 'trigger'));

-- Back-fill existing rows (all pre-existing entries were API calls)
UPDATE public.audit_trail
SET source = 'api'
WHERE source IS NULL;

COMMENT ON COLUMN public.audit_trail.source IS
  'How the audit action was triggered: '
  'api=frontend call, rpc=server/admin call, system=cron/background, trigger=DB trigger.';


-- ─── 2. Recreate log_audit_action with p_source + is_current_user_admin() ────
--
-- Changes vs. migration_security_audit_2026_04.sql:
--   a) New parameter p_source TEXT DEFAULT 'api'
--   b) Admin check: `profiles.is_admin = TRUE` → `public.is_current_user_admin()`
--      (fixes Risk 1 from rls-security-patterns.mdc: is_admin column may be NULL
--       after REVOKE, locking out admin from writing audit entries)
--   c) INSERT now includes `source` column

DROP FUNCTION IF EXISTS public.log_audit_action(UUID, TEXT, TEXT, UUID, JSONB, JSONB, TEXT);

CREATE OR REPLACE FUNCTION public.log_audit_action(
  p_org_id      UUID,
  p_action_type TEXT,
  p_entity_type TEXT    DEFAULT NULL,
  p_entity_id   UUID    DEFAULT NULL,
  p_old_data    JSONB   DEFAULT NULL,
  p_new_data    JSONB   DEFAULT NULL,
  p_ip_address  TEXT    DEFAULT NULL,
  p_source      TEXT    DEFAULT 'api'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_source    TEXT := coalesce(p_source, 'api');
BEGIN
  -- Validate source value (defense-in-depth: CHECK constraint covers DB but not RPC bypass)
  IF v_source NOT IN ('api', 'rpc', 'system', 'trigger') THEN
    v_source := 'api';  -- silently normalize unknown values
  END IF;

  -- INTERNAL GUARD: Admin check via is_current_user_admin() (not is_admin column).
  -- Fixed from previous version which used `profiles.is_admin = TRUE` directly —
  -- that could return NULL after a column REVOKE, blocking admin audit writes.
  IF public.is_current_user_admin() THEN
    -- Admin path: no org membership check required.
    NULL;
  ELSIF p_org_id IS NOT NULL THEN
    -- Normal users: enforce org membership to prevent cross-org audit spoofing.
    IF NOT EXISTS (
      SELECT 1
      FROM public.organization_members
      WHERE user_id       = v_caller_id
        AND organization_id = p_org_id
    ) THEN
      RAISE EXCEPTION 'permission_denied: caller is not a member of the specified organization'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  INSERT INTO public.audit_trail (
    user_id,
    org_id,
    action_type,
    entity_type,
    entity_id,
    old_data,
    new_data,
    ip_address,
    source,
    created_at
  ) VALUES (
    v_caller_id,
    p_org_id,
    p_action_type,
    p_entity_type,
    p_entity_id,
    p_old_data,
    p_new_data,
    p_ip_address,
    v_source,
    NOW()
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.log_audit_action(UUID, TEXT, TEXT, UUID, JSONB, JSONB, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_audit_action(UUID, TEXT, TEXT, UUID, JSONB, JSONB, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.log_audit_action IS
  'SECURE (20260413): p_source added + admin check via is_current_user_admin(). '
  'Writes to audit_trail. source default=api. Admin bypasses membership check. '
  'Normal users must be members of p_org_id. user_id=actor (auth.uid() auto-set).';


-- ─── 3. Verification ──────────────────────────────────────────────────────────
DO $$
DECLARE
  v_col_exists boolean;
  v_fn_exists  boolean;
BEGIN
  -- audit_trail.source column must exist
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'audit_trail'
      AND column_name  = 'source'
  ) INTO v_col_exists;
  ASSERT v_col_exists, 'FAIL: audit_trail.source column not found';

  -- log_audit_action must exist with 8 parameters (including p_source)
  SELECT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname  = 'log_audit_action'
      AND pronargs = 8
  ) INTO v_fn_exists;
  ASSERT v_fn_exists, 'FAIL: log_audit_action(8 params) not found';

  -- Must use is_current_user_admin() (not direct is_admin column check)
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'log_audit_action'
      AND prosrc ILIKE '%is_current_user_admin%'
  ), 'FAIL: log_audit_action still uses direct is_admin check (must use is_current_user_admin)';

  RAISE NOTICE 'PASS: 20260413_audit_trail_source_column — all verifications passed';
END $$;
