-- ────────────────────────────────────────────────────────────────────────────
-- Phase D-3: Revoke implicit PUBLIC EXECUTE on SECURITY DEFINER functions
--
-- After Phases A + B + C-1 + D + D-2, ten public.* SECURITY DEFINER functions
-- still expose `=X/postgres` (PUBLIC implicit EXECUTE grant) in their proacl.
--
-- Of these:
--   1) `check_anon_rate_limit(text, text, integer)` — documented in
--      `supabase/migration_backend_rate_limits_otp_guest.sql` as service_role
--      only. The original REVOKE statement only targeted anon + authenticated
--      explicitly and left the default PUBLIC grant intact. This is a real
--      hardening gap: any anon caller can still execute it via PUBLIC.
--
--   2) The remaining 9 functions are part of the documented KEEP_ANON
--      allowlist and have BOTH explicit `anon=X` AND implicit PUBLIC `=X/`.
--      The PUBLIC grant is redundant but harmless — anon executes via the
--      explicit grant either way. Removing it is defense-in-depth and brings
--      the ACL into a canonical shape.
--
-- This migration is idempotent (REVOKE on a non-existent grant is a no-op).
-- No functional change to anon callers because the explicit `anon=X` grant
-- remains on the 9 KEEP_ANON functions; `check_anon_rate_limit` becomes
-- service_role-only as the original migration intended.
-- ────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  fn_name text;
  fn_oid oid;
  fn_sig text;
  total_revoked int := 0;
BEGIN
  -- 10 functions confirmed via pg_proc snapshot 2026-05-10:
  --   acl ~ '(^|,)=X/'  AND  prosecdef = true  AND  schema = 'public'
  FOR fn_name IN
    SELECT unnest(ARRAY[
      'cancel_account_deletion',
      'check_anon_rate_limit',
      'get_model_claim_preview',
      'get_public_agency_models',
      'get_public_agency_profile',
      'get_public_client_gallery',
      'get_public_client_profile',
      'get_public_model_profile',
      'link_model_by_email',
      'upgrade_guest_to_client'
    ])
  LOOP
    FOR fn_oid, fn_sig IN
      SELECT p.oid,
             format('public.%I(%s)', p.proname,
                    pg_catalog.pg_get_function_identity_arguments(p.oid))
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = fn_name
    LOOP
      BEGIN
        EXECUTE 'REVOKE EXECUTE ON FUNCTION ' || fn_sig || ' FROM PUBLIC';
        total_revoked := total_revoked + 1;
        RAISE NOTICE '[D.3] Revoked PUBLIC EXECUTE on %', fn_sig;
      EXCEPTION WHEN undefined_function THEN
        RAISE NOTICE '[D.3] Function not found, skipping: %', fn_sig;
      WHEN insufficient_privilege THEN
        RAISE NOTICE '[D.3] Insufficient privilege to revoke PUBLIC on %, skipping', fn_sig;
      END;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Phase D-3 total PUBLIC EXECUTE revokes: %', total_revoked;
END $$;
