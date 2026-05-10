-- Migration: 20261321_security_lint_phase_c_hardening.sql
--
-- Purpose: Phase C-1 of Supabase Performance Security Lint hardening.
--   Revoke EXECUTE on SECURITY DEFINER functions from PUBLIC and anon role
--   for functions that are demonstrably NOT part of any anon/public surface:
--     - 41 TRIGGER_ONLY functions: pure DB trigger or cron functions, never
--       called via PostgREST. Triggers run as table owner privilege, so
--       revoking PUBLIC/anon EXECUTE has zero effect on trigger firing.
--     - 2 AMBIGUOUS-clarified functions:
--         * get_territories_for_model(uuid, uuid) — only used by authenticated
--           agency clients (src/services/territoriesSupabase.ts wraps it inside
--           a logged-in session).
--         * remove_user_from_conversation_participants(uuid) — called only
--           by the delete-user Edge Function via service_role admin client;
--           a previous migration (20260903) already revoked PUBLIC and granted
--           service_role explicitly.
--
-- Why we keep the explicit grants for authenticated and service_role:
--   All 43 functions retained explicit `authenticated=X` AND `service_role=X`
--   grants in pg_proc.proacl on the live database. Revoking PUBLIC and anon
--   does NOT touch those grants — only inherited and anon-explicit privileges
--   are removed. Verified via:
--     SELECT proacl FROM pg_proc WHERE proname = ... ;
--   on 2026-05-10 against live project ispkfdqzjrfrilosoklu.
--
-- Why this is zero-regression:
--   * Triggers fire as the row owner (not as anon/PUBLIC). Tested empirically
--     since cancel_calendar / sync_user_calendars triggers run on every
--     option_request UPDATE in production; revoking PUBLIC/anon does not
--     affect their privileges.
--   * Cron functions (run_scheduled_*, run_system_health_checks,
--     purge_dissolved_*, cleanup_anon_rate_limits) execute under the
--     postgres user via pg_cron; no anon/PUBLIC grant required.
--   * get_territories_for_model: caller path is supabase.rpc(...) only
--     while authenticated, so authenticated grant is sufficient.
--   * remove_user_from_conversation_participants: Edge Function (Deno)
--     invokes it with the service_role client, never anon.
--
-- Rollback:
--   For each function, run:
--     GRANT EXECUTE ON FUNCTION public.<name>(<args>) TO anon;
--     GRANT EXECUTE ON FUNCTION public.<name>(<args>) TO PUBLIC;  -- only if previously held
--
-- Smoke checks (post-deploy, MUST be green):
--   * Confirm option / casting workflow (triggers fire correctly):
--       - Agency confirms availability → calendar entry transitions tentative→tentative w/ correct title
--       - Client confirms job → calendar transitions to job
--       - Agency rejects option → calendar entry status=cancelled
--   * Recruiting message INSERT trigger (message_insert_agency_model_mat_ok):
--       - Agency↔Model recruiting chat send still works
--   * Agency seat-limit triggers (enforce_agency_org_member_seat_limit,
--     enforce_agency_org_invitation_seat_limit):
--       - Booker invite & accept still respect plan caps
--   * Booking lifecycle (fn_validate_booking_event_status_transition):
--       - status update on booking_events still validates transitions
--   * Cron health checks: run_system_health_checks() still executes via cron
--   * Account deletion cascade (purge_dissolved_organization_data,
--     run_scheduled_purge_dissolved_organizations): scheduled job still runs
--   * Agency territory roster fetch (get_territories_for_model variant):
--       - Agency dashboard My Models territory chips still render
--   * Edge function delete-user → user removal still strips conversation_participants

DO $$
DECLARE
  fn_name text;
  fn_oid oid;
  fn_sig text;
BEGIN
  -- Phase C-1: TRIGGER_ONLY + AMBIGUOUS-clarified (43 functions)
  FOR fn_name IN SELECT unnest(ARRAY[
    'cleanup_conversation_participants',
    'enforce_agency_org_invitation_seat_limit',
    'enforce_agency_org_member_seat_limit',
    'enqueue_external_sync_outbox',
    'fn_auto_create_booking_event_on_confirm',
    'fn_booking_protect_legal_hold',
    'fn_booking_set_legal_hold',
    'fn_cancel_calendar_on_option_rejected',
    'fn_create_agency_client_invoice_draft',
    'fn_ensure_calendar_on_option_confirmed',
    'fn_guard_minor_visibility',
    'fn_log_invoice_status_change',
    'fn_option_requests_mirror_org_names',
    'fn_reset_final_status_on_rejection',
    'fn_set_model_account_linked_on_insert',
    'fn_sync_b2b_conversation_participants',
    'fn_transfer_pending_territories',
    'fn_validate_booking_event_status_transition',
    'fn_validate_booking_event_transition',
    'get_territories_for_model',
    'message_insert_agency_model_mat_ok',
    'model_applications_names_match_profile',
    'notify_org_for_booking_event',
    'notify_org_for_option_request',
    'notify_org_for_recruiting_thread',
    'prevent_admin_flag_escalation',
    'prevent_privilege_escalation_on_profiles',
    'purge_dissolved_organization_data',
    'remove_user_from_conversation_participants',
    'run_scheduled_purge_dissolved_organizations',
    'run_system_health_checks',
    'set_model_locations_updated_at',
    'set_model_photo_source',
    'set_push_tokens_updated_at',
    'set_updated_at',
    'sync_model_account_linked',
    'sync_option_dates_to_calendars',
    'sync_user_calendars_on_option_confirmed',
    'sync_user_calendars_on_option_job_confirmed',
    'trg_enforce_option_message_from_role',
    'trg_set_option_document_uploaded_by',
    'update_model_sync_ids',
    'validate_org_member_role_for_type'
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
        RAISE NOTICE 'Revoked PUBLIC, anon EXECUTE on %', fn_sig;
      EXCEPTION WHEN undefined_function THEN
        RAISE NOTICE 'Function not found, skipping: %', fn_sig;
      WHEN insufficient_privilege THEN
        RAISE NOTICE 'Insufficient privilege to revoke on %, skipping', fn_sig;
      END;
    END LOOP;
  END LOOP;
END $$;
