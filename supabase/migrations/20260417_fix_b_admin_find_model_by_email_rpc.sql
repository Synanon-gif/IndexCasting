-- =============================================================================
-- Fix B: admin_find_model_by_email — Admin-only RPC for import dedup
-- Date: 2026-04-17
--
-- Problem:
--   modelsImportSupabase.ts uses direct email-matching query:
--     supabase.from('models').eq('email', emailNorm)
--   This violates rls-security-patterns.mdc Risiko D and Gefahr 2:
--   "Email-Lookup — Verboten in JEDER Datei (auch Admin-Code)"
--
-- Fix:
--   Admin-only SECURITY DEFINER RPC that handles the email lookup
--   server-side. assert_is_admin() as first guard ensures only the
--   admin can call this. Used exclusively as a dedup fallback in the
--   model import flow (third fallback after externalId and netwalkId).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_find_model_by_email(p_email text)
RETURNS SETOF public.models
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
BEGIN
  -- Guard 1: Admin-only — UUID+email-pinned via assert_is_admin()
  PERFORM public.assert_is_admin();

  -- Return the model with this email (at most one — email is unique per model).
  -- LIMIT 1 is a Sub-Resource-Lookup after the guard above (see system-invariants.mdc:
  -- "LIMIT 1 in SECURITY DEFINER Scope Guards for Sub-Resource-Lookups AFTER
  -- verified guard is allowed" — here the guard is assert_is_admin()).
  RETURN QUERY
    SELECT *
    FROM   public.models
    WHERE  email = lower(trim(p_email))
    LIMIT  1;
END;
$$;

REVOKE ALL    ON FUNCTION public.admin_find_model_by_email(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_find_model_by_email(text) TO authenticated;

COMMENT ON FUNCTION public.admin_find_model_by_email IS
  'Admin-only: find a model row by email address (import dedup fallback). '
  'Replaces direct frontend email query (Gefahr 2 / Risiko D compliance). '
  'assert_is_admin() as first guard (UUID+email-pinned); row_security=off. '
  'Created 20260417.';

-- ── Verification ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'admin_find_model_by_email'
      AND p.prosecdef = true
      AND 'row_security=off' = ANY(p.proconfig)
  ), 'FAIL: admin_find_model_by_email missing SECURITY DEFINER or row_security=off';

  RAISE NOTICE '20260417_fix_b: admin_find_model_by_email created — OK';
END $$;
