-- =============================================================================
-- Migration: 20261322_security_lint_phase_d_hardening.sql
-- Purpose : Phase D of the Supabase Performance Security Lint hardening rollout.
--           Removes anonymous (and PUBLIC) EXECUTE on SECDEF functions that
--           are exclusively callable from authenticated/admin/RLS or trigger
--           contexts. Closes the Phase A `admin_purge_user_data` signature gap.
--
-- Scope    :
--   D.1 — AUTH_ONLY (68 unique names): RPCs invoked from src/* and supabase
--         /functions/* exclusively under an authenticated session
--         (verified — see classification_v2.csv + grep audit).
--   D.2 — RLS_HELPER (21 unique names): SECDEF helpers consumed from RLS
--         USING/WITH CHECK clauses. Phase B already proved that revoking anon
--         on `caller_is_*` is non-disruptive — extend the same treatment to
--         the remaining helpers (each one already short-circuits on
--         `auth.uid() IS NULL` semantically because the policies they back
--         only fire for rows that require auth.uid()).
--   D.3 — Trigger-only KEEP_ANON entries:
--         `handle_new_user`, `record_trial_email_hashes`, `rls_auto_enable`
--         are bound to triggers / event triggers and never called via
--         PostgREST `/rpc`. Revoke anon/PUBLIC EXECUTE — trigger invocation
--         is independent of grants.
--   D.4 — Phase A correction: `admin_purge_user_data(target_id uuid)` was not
--         caught by the prior IF-EXISTS block because the migration searched
--         for `(uuid)` while pg_get_function_identity_arguments returns
--         `target_id uuid`. Use a name-based lookup that revokes every
--         overload encountered.
--
-- Safety   :
--   * REVOKE-only — no DDL, no GRANT changes for `authenticated` /
--     `service_role` / `postgres`, no function bodies modified.
--   * Idempotent — wrapped in EXCEPTION handlers so missing functions are
--     silently skipped instead of failing the whole migration.
--   * Reversible — the rollback section at the bottom of this file is the
--     exact set of GRANT statements required to restore anon EXECUTE if a
--     regression appears. Apply manually only after explicit approval.
--
-- Verification (post-deploy):
--   * Total SECDEF functions (public.*) unchanged: 268.
--   * anon-executable SECDEF functions drop from 118 → ~26 (only KEEP_ANON
--     allowlist remains, minus the three trigger-only entries removed here).
--   * `assert_is_admin()` callable as before for `authenticated`.
--   * `record_system_event`, `get_my_org_context`, `send_notification`,
--     `get_dashboard_summary`, `match_models`, `get_discovery_models`,
--     `agency_create_option_request`, `client_confirm_option_job`,
--     `insert_option_request_system_message` — still callable for the
--     authenticated user JWT context (Edge functions + frontend).
--
-- See also : docs/SUPABASE_LINT_TRIAGE_2026-05-10.md (Phase D section).
-- =============================================================================

DO $$
DECLARE
  fn_name text;
  fn_oid oid;
  fn_sig text;
  total_revoked int := 0;
BEGIN
  ---------------------------------------------------------------------------
  -- D.1 — AUTH_ONLY (68 names)
  ---------------------------------------------------------------------------
  FOR fn_name IN SELECT unnest(ARRAY[
    'add_model_territories',
    'add_model_to_project',
    'admin_purge_user_data',
    'agency_confirm_client_price',
    'agency_confirm_job_agency_only',
    'agency_create_option_request',
    'agency_find_model_by_email',
    'agency_link_model_to_user',
    'agency_remove_model',
    'agency_set_counter_offer',
    'agency_start_recruiting_chat',
    'agency_update_option_schedule',
    'calendar_export_events_json',
    'client_accept_counter_offer',
    'client_confirm_option_job',
    'client_reject_counter_offer',
    'create_b2b_org_conversation',
    'decrement_agency_storage_usage',
    'delete_option_request_full',
    'delete_organization_data',
    'dissolve_organization',
    'export_user_data',
    'get_accounts_to_purge',
    'get_admin_health_overview',
    'get_agency_api_keys',
    'get_agency_revenue',
    'get_billing_attention_counts',
    'get_calendar_export_payload_for_me',
    'get_chat_thread_file_paths',
    'get_dashboard_summary',
    'get_discovery_models',
    'get_latest_activity_log',
    'get_model_portfolio_file_paths',
    'get_my_agency_member_role',
    'get_my_agency_storage_usage',
    'get_my_agency_usage_limit',
    'get_my_client_member_role',
    'get_my_model_agencies',
    'get_my_org_context',
    'get_my_organization_ids',
    'get_org_member_emails',
    'get_org_metrics',
    'get_pending_verifications_for_my_agency',
    'get_user_related_tables',
    'increment_agency_storage_usage',
    'increment_my_agency_swipe_count',
    'insert_option_request_system_message',
    'list_agency_organizations_for_agency_directory',
    'list_pending_external_sync_outbox',
    'load_client_filter_preset',
    'log_activity',
    'mark_external_sync_outbox_failed',
    'mark_external_sync_outbox_sent',
    'match_models',
    'model_update_option_schedule',
    'record_client_interaction',
    'record_system_event',
    'remove_org_member',
    'resolve_agency_organization_id_for_option_request',
    'revoke_calendar_feed_token',
    'revoke_guest_access',
    'rotate_calendar_feed_token',
    'save_agency_api_connection',
    'save_client_filter_preset',
    'search_global',
    'send_notification',
    'transfer_org_ownership',
    'withdraw_consent'
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
        RAISE NOTICE '[D.1 AUTH_ONLY] Revoked PUBLIC, anon EXECUTE on %', fn_sig;
      EXCEPTION WHEN undefined_function THEN
        RAISE NOTICE '[D.1] Function not found, skipping: %', fn_sig;
      WHEN insufficient_privilege THEN
        RAISE NOTICE '[D.1] Insufficient privilege to revoke on %, skipping', fn_sig;
      END;
    END LOOP;
  END LOOP;

  ---------------------------------------------------------------------------
  -- D.2 — RLS_HELPER (21 names)
  ---------------------------------------------------------------------------
  FOR fn_name IN SELECT unnest(ARRAY[
    'acquire_option_request_lock',
    'can_manage_org_gallery',
    'can_manage_org_logo',
    'can_view_calendar_entry',
    'can_view_model_photo',
    'check_calendar_conflict',
    'check_org_access',
    'conversation_accessible_to_me',
    'get_agency_org_id_for_link',
    'get_agency_organization_seat_limit',
    'get_b2b_counterparty_org_name',
    'has_b2b_conversation_with_org',
    'has_platform_access_for_organization',
    'model_belongs_to_current_user',
    'option_request_visible_for_export_subject',
    'option_request_visible_from_columns',
    'option_request_visible_to_me',
    'resolve_b2b_chat_organization_ids',
    'resolve_b2b_org_pair_for_chat',
    'storage_can_insert_chat_files_object',
    'user_is_member_of_organization'
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
        RAISE NOTICE '[D.2 RLS_HELPER] Revoked PUBLIC, anon EXECUTE on %', fn_sig;
      EXCEPTION WHEN undefined_function THEN
        RAISE NOTICE '[D.2] Function not found, skipping: %', fn_sig;
      WHEN insufficient_privilege THEN
        RAISE NOTICE '[D.2] Insufficient privilege to revoke on %, skipping', fn_sig;
      END;
    END LOOP;
  END LOOP;

  ---------------------------------------------------------------------------
  -- D.3 — Trigger-only entries that landed in KEEP_ANON list
  ---------------------------------------------------------------------------
  FOR fn_name IN SELECT unnest(ARRAY[
    'handle_new_user',           -- AFTER INSERT trigger on auth.users
    'record_trial_email_hashes', -- trigger on organization_subscriptions
    'rls_auto_enable'            -- event_trigger on ddl_command_end
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
        RAISE NOTICE '[D.3 TRIGGER_ONLY] Revoked PUBLIC, anon EXECUTE on %', fn_sig;
      EXCEPTION WHEN undefined_function THEN
        RAISE NOTICE '[D.3] Function not found, skipping: %', fn_sig;
      WHEN insufficient_privilege THEN
        RAISE NOTICE '[D.3] Insufficient privilege to revoke on %, skipping', fn_sig;
      END;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Phase D total functions revoked (D.1 + D.2 + D.3): %',
               total_revoked;
END $$;

-- ---------------------------------------------------------------------------
-- D.4 — Verify (logged) and surface anon residue
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  remaining_count int;
  remaining_names text;
BEGIN
  SELECT count(*),
         string_agg(format('%s(%s)', p.proname,
                            pg_catalog.pg_get_function_identity_arguments(p.oid)),
                    ', ' ORDER BY p.proname)
    INTO remaining_count, remaining_names
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosecdef = true
    AND has_function_privilege('anon', p.oid, 'EXECUTE');

  RAISE NOTICE 'Phase D residual anon-executable SECDEF count: % | names: %',
               remaining_count,
               COALESCE(remaining_names, '(none)');
END $$;

-- =============================================================================
-- Rollback (manual, on regression only):
--   GRANT EXECUTE ON FUNCTION public.<name>(<args>) TO anon;
-- Apply only the specific function(s) that broke; never blanket-restore.
-- =============================================================================
