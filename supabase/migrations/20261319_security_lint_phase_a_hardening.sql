-- ============================================================================
-- Security lint Phase A — defense-in-depth (no RLS/storage/auth/data changes)
--
-- Goals (Supabase database linter):
--   1) REVOKE EXECUTE FROM anon on internal / high-blast SECDEF surfaces that
--      must never be called without a session (PostgREST /rpc as anon).
--   2) ALTER FUNCTION … SET search_path for functions flagged
--      function_search_path_mutable (trigger + SQL helpers + consent version).
--
-- Explicitly OUT OF SCOPE (later phases / manual QA):
--   - public/guest allowlist RPCs documented in Phase-2 security plan (unchanged here)
--   - authenticated-wide SECDEF inventory (majority of lints remain)
--   - storage policies, leaked-password Auth toggle, bucket listing lint
--
-- Cron / service_role:
--   - pg_cron for run_system_health_checks / GDPR retention runs elevated;
--     revoking anon does not remove superuser cron execution.
-- ============================================================================

-- ── A) REVOKE anon — GDPR retention orchestrator & sub-functions ─────────────
-- Source: 20260813_security_gdpr_retention_orchestrator.sql (revoked PUBLIC +
-- authenticated but anon could still EXECUTE via project defaults).

REVOKE EXECUTE ON FUNCTION public.gdpr_purge_expired_deletions() FROM anon;
REVOKE EXECUTE ON FUNCTION public.gdpr_purge_old_audit_trail() FROM anon;
REVOKE EXECUTE ON FUNCTION public.gdpr_purge_old_security_events() FROM anon;
REVOKE EXECUTE ON FUNCTION public.gdpr_purge_old_guest_link_access_log() FROM anon;
REVOKE EXECUTE ON FUNCTION public.gdpr_run_all_retention_cleanup() FROM anon;

-- ── B) REVOKE anon — observability internal writer + cron entry RPC ─────────
-- _record_* is SECURITY DEFINER and must not be reachable as anon PostgREST.
-- run_system_health_checks is SECURITY DEFINER; granted authenticated for
-- manual admin reruns — anon must not invoke it.

REVOKE EXECUTE ON FUNCTION public._record_system_health_check(
  text, text, text, text, text, boolean, text, bigint, jsonb
) FROM anon;

REVOKE EXECUTE ON FUNCTION public.run_system_health_checks() FROM anon;

-- ── C) REVOKE anon — admin / GDPR user RPCs (guarded; authenticated only) ──
-- Signatures from latest canonical migrations (assert_is_admin / self-or-admin).

REVOKE EXECUTE ON FUNCTION public.admin_set_bypass_paywall(uuid, boolean, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_convert_org_type(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.anonymize_user_data(uuid) FROM anon;

-- admin_purge_user_data: defined in legacy root SQL, not in migrations/;
-- revoking only if the function exists (fresh migration-only DBs may lack it).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'admin_purge_user_data'
      AND pg_catalog.pg_get_function_identity_arguments(p.oid) = 'uuid'
  ) THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.admin_purge_user_data(uuid) FROM anon';
  END IF;
END;
$$;

-- ── D) search_path hardening (lint 0011_function_search_path_mutable) ───────
-- prevent_admin_flag_escalation: intentionally omitted — dropped in
-- 20260408_admin_security_hardening.sql (no stable object to alter).

ALTER FUNCTION public.tg_system_health_checks_touch() SET search_path = public;

ALTER FUNCTION public.touch_client_assignment_flags_updated_at() SET search_path = public;

ALTER FUNCTION public.gdpr_export_actor_ref(uuid, uuid) SET search_path = public;

ALTER FUNCTION public.gdpr_export_participant_refs(uuid[], uuid) SET search_path = public;

ALTER FUNCTION public.fn_option_message_hide_price_from_model() SET search_path = public;

ALTER FUNCTION public.fn_prevent_option_price_mutation_after_acceptance() SET search_path = public;

ALTER FUNCTION public.fn_invoices_set_updated_at() SET search_path = public;

ALTER FUNCTION public.fn_invoices_freeze_snapshot() SET search_path = public;

-- Restores explicit search_path dropped when version string bumped in 20261304.
ALTER FUNCTION public.ai_assistant_expected_consent_version() SET search_path = public;
