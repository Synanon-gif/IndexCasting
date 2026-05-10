-- =============================================================================
-- Migration: 20261323_security_lint_phase_d2_stragglers.sql
-- Purpose : Phase D-2 — close the residue of SECDEF functions that prior
--           hardening passes (Phase A/B/C/D) did not catch because they
--           were recreated by later migrations or were absent from the
--           original lint-derived allowlists.
--
-- Coverage :
--   * admin_set_account_active(target_id uuid, active boolean, reason text)
--   * admin_update_profile(target_id uuid, field_name text, field_value text)
--     — both guarded internally by `assert_is_admin()`. Anon/PUBLIC EXECUTE
--       has zero product utility (RPC fails for non-admin) but still trips
--       the Supabase lint and exposes a `400` not_admin response surface
--       to anonymous probes.
--   * auto_create_agency_storage_usage()
--   * auto_create_agency_usage_limit()
--   * auto_create_org_subscription()
--     — TRIGGER functions on `organizations`. Never invoked via PostgREST.
--   * caller_is_member_of_agency_org(p_org_id uuid)
--     — RLS helper. Phase B revoked anon for many `caller_is_*` overloads
--       but this signature was either added or recreated afterwards.
--
-- Idempotent + non-destructive: REVOKE-only with EXCEPTION-safe loop.
-- See docs/SUPABASE_LINT_TRIAGE_2026-05-10.md (Phase D-2 section).
-- =============================================================================

DO $$
DECLARE
  fn_name text;
  fn_oid oid;
  fn_sig text;
  total_revoked int := 0;
BEGIN
  FOR fn_name IN SELECT unnest(ARRAY[
    'admin_set_account_active',
    'admin_update_profile',
    'auto_create_agency_storage_usage',
    'auto_create_agency_usage_limit',
    'auto_create_org_subscription',
    'caller_is_member_of_agency_org'
  ]) LOOP
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
        EXECUTE 'REVOKE EXECUTE ON FUNCTION ' || fn_sig || ' FROM anon';
        total_revoked := total_revoked + 1;
        RAISE NOTICE '[D.2 STRAGGLER] Revoked PUBLIC, anon EXECUTE on %', fn_sig;
      EXCEPTION WHEN undefined_function THEN
        RAISE NOTICE '[D.2] Function not found, skipping: %', fn_sig;
      WHEN insufficient_privilege THEN
        RAISE NOTICE '[D.2] Insufficient privilege to revoke on %, skipping', fn_sig;
      END;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Phase D-2 total functions revoked: %', total_revoked;
END $$;

-- ---------------------------------------------------------------------------
-- Final residue check (logged only — does not fail the migration)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  remaining_count int;
BEGIN
  SELECT count(*)
    INTO remaining_count
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosecdef = true
    AND has_function_privilege('anon', p.oid, 'EXECUTE');

  RAISE NOTICE 'Phase D-2 final anon-executable SECDEF count: % '
               '(target ~26: KEEP_ANON guest/public/signup allowlist)',
               remaining_count;
END $$;

-- =============================================================================
-- Rollback (manual, on regression only):
--   GRANT EXECUTE ON FUNCTION public.<name>(<args>) TO anon;
-- =============================================================================
