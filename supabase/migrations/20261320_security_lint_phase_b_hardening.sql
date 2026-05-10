-- ============================================================================
-- Security lint Phase B — defense-in-depth (no RLS / storage / auth changes)
--
-- Goals (Supabase database linter, after Phase A 20261319):
--   1) ALTER FUNCTION public.prevent_admin_flag_escalation() SET search_path
--      to remove the last lint 0011_function_search_path_mutable.
--      Function is the BEFORE UPDATE trigger on public.profiles that blocks
--      is_admin / is_super_admin escalation; runs only as a trigger, never
--      via REST/PostgREST. Live verified 2026-05-10:
--        proconfig=null, attached as trg_prevent_admin_flag_escalation on profiles.
--
--   2) REVOKE EXECUTE FROM anon on internal SECDEF surfaces that must never
--      be reachable without a session via PostgREST /rpc:
--        a) Admin RPCs (already guarded by assert_is_admin() — defense-in-depth)
--        b) RLS caller_is_* helpers (require auth.uid(); useless for anon)
--        c) auto_create_* trigger functions (only run as triggers; no /rpc use)
--
-- Out of scope (separate later phases / manual QA):
--   - public/guest allowlist RPCs (accept_organization_invitation,
--     accept_guest_link_tos, generate_*, get_guest_link_*, ...) — must keep anon
--   - authenticated-wide SECDEF inventory (258 lints; product-critical RPCs
--     require explicit per-function review before any REVOKE)
--   - storage policies (organization-logos, organization-profiles bucket lints)
--   - leaked-password Auth toggle (dashboard config, not migration)
--
-- Safety guarantees:
--   - No DROP, no CREATE, no policy change, no data write.
--   - No GRANT change for authenticated / service_role / postgres.
--   - REVOKE wrapped in DO blocks with IF EXISTS guards: idempotent and
--     safe on databases that lack a function (e.g. fresh migrations-only
--     environments without legacy functions).
--   - Each REVOKE references the live (Production) function signature
--     verified via pg_proc on 2026-05-10 (project ispkfdqzjrfrilosoklu).
--
-- Rollback (if a regression surfaces):
--   GRANT EXECUTE ON FUNCTION public.<name>(<args>) TO anon;
-- ============================================================================

-- ── A) search_path hardening ────────────────────────────────────────────────
-- Trigger function on profiles. Live drift: repo claimed dropped, but the
-- function still exists and is bound to trg_prevent_admin_flag_escalation.
-- ALTER is wrapped in DO/IF EXISTS so the migration is also safe on a fresh
-- database where the trigger function has been removed.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'prevent_admin_flag_escalation'
      AND pg_catalog.pg_get_function_identity_arguments(p.oid) = ''
  ) THEN
    EXECUTE 'ALTER FUNCTION public.prevent_admin_flag_escalation() SET search_path = public';
  END IF;
END;
$$;

-- ── B) anon REVOKE — admin_* RPCs (assert_is_admin() guarded) ───────────────
-- Each function lives behind PERFORM public.assert_is_admin(). REVOKE FROM
-- anon is pure defense-in-depth: anon callers would already be rejected by
-- the guard, but REVOKE removes them from the PostgREST surface entirely.

DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT format(
      '%I(%s)',
      p.proname,
      pg_catalog.pg_get_function_identity_arguments(p.oid)
    ) AS sig
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY(ARRAY[
        'admin_backfill_all_no_org_accounts',
        'admin_backfill_org_for_user',
        'admin_detect_model_link_inconsistencies',
        'admin_detect_orphaned_model_rows',
        'admin_find_model_by_email',
        'admin_get_org_storage_usage',
        'admin_get_org_subscription',
        'admin_list_all_models',
        'admin_list_org_memberships',
        'admin_list_organizations',
        'admin_reset_agency_swipe_count',
        'admin_reset_to_default_storage_limit',
        'admin_set_account_active',
        'admin_set_agency_storage_usage',
        'admin_set_agency_swipe_limit',
        'admin_set_model_active',
        'admin_set_org_active',
        'admin_set_org_plan',
        'admin_set_organization_member_role',
        'admin_set_storage_limit',
        'admin_set_unlimited_storage',
        'admin_update_model_notes',
        'admin_update_org_details',
        'admin_update_profile'
      ])
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM anon', rec.sig);
  END LOOP;
END;
$$;

-- ── C) anon REVOKE — caller_is_* RLS helpers (auth.uid() based) ─────────────
-- Used inside RLS USING/WITH CHECK clauses; never invoked from anon sessions.

DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT format(
      '%I(%s)',
      p.proname,
      pg_catalog.pg_get_function_identity_arguments(p.oid)
    ) AS sig
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY(ARRAY[
        'caller_is_any_agency_member',
        'caller_is_client_org_member',
        'caller_is_linked_model',
        'caller_is_member_of_agency_org'
      ])
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM anon', rec.sig);
  END LOOP;
END;
$$;

-- ── D) anon REVOKE — auto_create_* trigger functions ────────────────────────
-- Pure trigger functions (created by AFTER INSERT triggers on org tables).
-- Never called via REST/PostgREST.

DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT format(
      '%I(%s)',
      p.proname,
      pg_catalog.pg_get_function_identity_arguments(p.oid)
    ) AS sig
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY(ARRAY[
        'auto_create_agency_storage_usage',
        'auto_create_agency_usage_limit',
        'auto_create_org_subscription'
      ])
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM anon', rec.sig);
  END LOOP;
END;
$$;

-- ── Verification (advisory, will not block deploy) ──────────────────────────
-- After deploy, the Supabase advisor should show:
--   - function_search_path_mutable: 0 (down from 10 → after Phase A: 1)
--   - anon_security_definer_function_executable: 204 → 174 (-30)
-- No expected change to authenticated_security_definer_function_executable
-- in this phase (intentionally out of scope).
