-- =============================================================================
-- Migration B: purge_dissolved_organization_data RPC + scheduled batch wrapper
--
-- Stage 2 of the Two-Stage Org-Dissolve model (companion to Migration A
-- 20260418_dissolve_organization_v2_softdissolve.sql):
--
--   • purge_dissolved_organization_data(p_org_id, p_force) — admin-only
--     hard-purge of one dissolved organization. Removes ALL B2B data that
--     references the org via SET-NULL or NO-ACTION FKs, then DELETEs the
--     organizations row → CASCADE handles the remaining org-scoped tables.
--
--   • run_scheduled_purge_dissolved_organizations(p_limit) — admin-only
--     batch wrapper. Iterates over orgs whose scheduled_purge_at <= now()
--     and dispatches the per-org purge. Used by the cron job in Migration C.
--
-- GDPR mapping (Art. 17 right to erasure, Art. 5 minimization):
--   • All B2B records carrying personal data of former members or
--     interacting clients/agencies are removed.
--   • Audit trail (admin_logs / audit_trail / security_events) keeps
--     org_id = NULL via existing FK SET NULL — required for Art. 30
--     processing record and legal-defense retention.
--   • image_rights_confirmations: org_id → NULL by FK; the consent
--     evidence itself stays for Art. 7(1) ("demonstrate consent").
--   • used_trial_emails: hashed marker stays for anti-abuse (no PII).
--
-- Idempotent: re-running on an already-purged org is a no-op
-- (returns ok=true, purged_at preserved).
--
-- Failure isolation: each per-table DELETE is wrapped so that one bad
-- table cannot block the rest. Counts and warnings are returned in JSON.
-- =============================================================================

-- ─── 1. purge_dissolved_organization_data ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.purge_dissolved_organization_data(
  p_organization_id UUID,
  p_force           BOOLEAN DEFAULT FALSE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_caller_uid           uuid := auth.uid();
  v_org                  record;
  v_now                  timestamptz := now();
  v_counts               jsonb := '{}'::jsonb;
  v_warnings             jsonb := '[]'::jsonb;

  -- option_requests this org appears in (any role)
  v_opt_request_ids      uuid[];
  -- conversations this org appears in (any role)
  v_conversation_ids     uuid[];
  -- recruiting threads owned by this org
  v_recruiting_ids       uuid[];
  -- client_projects owned by this org
  v_project_ids          uuid[];
  -- agency_event_groups owned by this org (NO ACTION FK → must be purged)
  v_event_group_ids      uuid[];
  -- temp count holder
  v_n                    integer;
BEGIN
  -- Admin-only (or service-role with auth.uid() NULL via SECURITY DEFINER bypass).
  -- We require admin to keep this off the user surface entirely.
  IF v_caller_uid IS NOT NULL AND NOT public.is_current_user_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden_admin_only');
  END IF;

  SELECT id, name, dissolved_at, scheduled_purge_at
    INTO v_org
    FROM public.organizations
   WHERE id = p_organization_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'note', 'organization_already_deleted');
  END IF;

  IF v_org.dissolved_at IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'organization_not_dissolved',
      'hint', 'Call public.dissolve_organization first.'
    );
  END IF;

  IF NOT p_force AND v_org.scheduled_purge_at IS NOT NULL AND v_org.scheduled_purge_at > v_now THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'purge_window_not_reached',
      'scheduled_purge_at', v_org.scheduled_purge_at,
      'hint', 'Pass p_force => true to override the 30-day window.'
    );
  END IF;

  -- ─── Collect dependent IDs (so we can CASCADE-purge their children) ─────────
  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_opt_request_ids
    FROM public.option_requests
   WHERE organization_id        = p_organization_id
      OR agency_organization_id = p_organization_id
      OR client_organization_id = p_organization_id;

  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_conversation_ids
    FROM public.conversations
   WHERE agency_organization_id = p_organization_id
      OR client_organization_id = p_organization_id;

  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_recruiting_ids
    FROM public.recruiting_chat_threads
   WHERE organization_id = p_organization_id;

  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_project_ids
    FROM public.client_projects
   WHERE organization_id = p_organization_id;

  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_event_group_ids
    FROM public.agency_event_groups
   WHERE agency_organization_id = p_organization_id;

  -- ─── Purge calendar/booking artefacts that have NO FK on org ───────────────
  -- calendar_entries.option_request_id has no FK; we drop entries for the
  -- option_requests we are about to delete so no zombie schedule rows remain.
  IF array_length(v_opt_request_ids, 1) IS NOT NULL THEN
    BEGIN
      DELETE FROM public.calendar_entries
       WHERE option_request_id = ANY(v_opt_request_ids);
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_counts := v_counts || jsonb_build_object('calendar_entries', v_n);
    EXCEPTION WHEN OTHERS THEN
      v_warnings := v_warnings || jsonb_build_array(format('calendar_entries: %s', SQLERRM));
    END;

    BEGIN
      DELETE FROM public.user_calendar_events
       WHERE source_option_request_id = ANY(v_opt_request_ids)
          OR organization_id          = p_organization_id;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_counts := v_counts || jsonb_build_object('user_calendar_events', v_n);
    EXCEPTION WHEN OTHERS THEN
      v_warnings := v_warnings || jsonb_build_array(format('user_calendar_events: %s', SQLERRM));
    END;

    BEGIN
      DELETE FROM public.booking_events
       WHERE source_option_request_id = ANY(v_opt_request_ids)
          OR agency_org_id            = p_organization_id
          OR client_org_id            = p_organization_id;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_counts := v_counts || jsonb_build_object('booking_events', v_n);
    EXCEPTION WHEN OTHERS THEN
      v_warnings := v_warnings || jsonb_build_array(format('booking_events: %s', SQLERRM));
    END;
  END IF;

  -- ─── option_requests (CASCADE → option_documents, option_request_messages) ──
  IF array_length(v_opt_request_ids, 1) IS NOT NULL THEN
    BEGIN
      DELETE FROM public.option_requests WHERE id = ANY(v_opt_request_ids);
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_counts := v_counts || jsonb_build_object('option_requests', v_n);
    EXCEPTION WHEN OTHERS THEN
      v_warnings := v_warnings || jsonb_build_array(format('option_requests: %s', SQLERRM));
    END;
  END IF;

  -- ─── conversations (CASCADE → messages) ────────────────────────────────────
  IF array_length(v_conversation_ids, 1) IS NOT NULL THEN
    BEGIN
      DELETE FROM public.conversations WHERE id = ANY(v_conversation_ids);
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_counts := v_counts || jsonb_build_object('conversations', v_n);
    EXCEPTION WHEN OTHERS THEN
      v_warnings := v_warnings || jsonb_build_array(format('conversations: %s', SQLERRM));
    END;
  END IF;

  -- ─── recruiting_chat_threads (CASCADE → recruiting_chat_messages) ──────────
  IF array_length(v_recruiting_ids, 1) IS NOT NULL THEN
    BEGIN
      DELETE FROM public.recruiting_chat_threads WHERE id = ANY(v_recruiting_ids);
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_counts := v_counts || jsonb_build_object('recruiting_chat_threads', v_n);
    EXCEPTION WHEN OTHERS THEN
      v_warnings := v_warnings || jsonb_build_array(format('recruiting_chat_threads: %s', SQLERRM));
    END;
  END IF;

  -- ─── client_projects (CASCADE → client_project_models) ─────────────────────
  IF array_length(v_project_ids, 1) IS NOT NULL THEN
    BEGIN
      DELETE FROM public.client_projects WHERE id = ANY(v_project_ids);
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_counts := v_counts || jsonb_build_object('client_projects', v_n);
    EXCEPTION WHEN OTHERS THEN
      v_warnings := v_warnings || jsonb_build_array(format('client_projects: %s', SQLERRM));
    END;
  END IF;

  -- ─── client_agency_connections (both directions) ───────────────────────────
  BEGIN
    DELETE FROM public.client_agency_connections
     WHERE from_organization_id = p_organization_id
        OR to_organization_id   = p_organization_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('client_agency_connections', v_n);
  EXCEPTION WHEN OTHERS THEN
    v_warnings := v_warnings || jsonb_build_array(format('client_agency_connections: %s', SQLERRM));
  END;

  -- ─── agency_event_groups (NO ACTION FK → must be purged before org) ────────
  IF array_length(v_event_group_ids, 1) IS NOT NULL THEN
    BEGIN
      DELETE FROM public.agency_event_groups WHERE id = ANY(v_event_group_ids);
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_counts := v_counts || jsonb_build_object('agency_event_groups', v_n);
    EXCEPTION WHEN OTHERS THEN
      v_warnings := v_warnings || jsonb_build_array(format('agency_event_groups: %s', SQLERRM));
    END;
  END IF;

  -- ─── Final DELETE on organizations → CASCADE removes the rest:
  --     activity_logs, admin_overrides, agency_usage_limits,
  --     client_assignment_flags, client_model_interactions,
  --     invitations, model_assignments, notifications (org-scoped only),
  --     organization_billing_*, organization_daily_usage,
  --     organization_members, organization_profile_media,
  --     organization_profiles, organization_storage_usage,
  --     organization_subscriptions
  --
  --   SET NULL FKs that we did NOT pre-purge intentionally remain
  --   nulled-out (admin_logs, audit_trail, security_events,
  --   image_rights_confirmations, used_trial_emails) — see header.
  -- ──────────────────────────────────────────────────────────────────────────
  BEGIN
    DELETE FROM public.organizations WHERE id = p_organization_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('organizations', v_n);
  EXCEPTION WHEN OTHERS THEN
    -- If this fails the whole purge is incomplete; surface the error.
    RETURN jsonb_build_object(
      'ok',       false,
      'error',    'organization_delete_failed',
      'sqlerrm',  SQLERRM,
      'counts',   v_counts,
      'warnings', v_warnings
    );
  END;

  RETURN jsonb_build_object(
    'ok',                 true,
    'organization_id',    p_organization_id,
    'organization_name',  v_org.name,
    'dissolved_at',       v_org.dissolved_at,
    'scheduled_purge_at', v_org.scheduled_purge_at,
    'purged_at',          v_now,
    'forced',             p_force,
    'counts',             v_counts,
    'warnings',           v_warnings
  );
END;
$$;

REVOKE ALL ON FUNCTION public.purge_dissolved_organization_data(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_dissolved_organization_data(UUID, BOOLEAN) TO service_role;
-- Authenticated grant ONLY for admins; the function itself enforces is_current_user_admin().
GRANT EXECUTE ON FUNCTION public.purge_dissolved_organization_data(UUID, BOOLEAN) TO authenticated;

COMMENT ON FUNCTION public.purge_dissolved_organization_data(uuid, boolean) IS
  'Stage-2 hard-purge of a dissolved organization. Admin-only (or service_role via cron). '
  'Removes all B2B records that reference the org via SET-NULL/NO-ACTION FKs, '
  'then DELETE on organizations triggers the remaining CASCADE FKs. '
  'p_force=true bypasses the 30-day scheduled_purge_at window. '
  'Audit-trail FKs (admin_logs, audit_trail, security_events, image_rights_confirmations) '
  'remain with org_id = NULL by design (GDPR Art. 30 / Art. 7(1)).';

-- ─── 2. run_scheduled_purge_dissolved_organizations ───────────────────────────
CREATE OR REPLACE FUNCTION public.run_scheduled_purge_dissolved_organizations(
  p_limit INTEGER DEFAULT 25
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_caller_uid uuid := auth.uid();
  v_org_id     uuid;
  v_result     jsonb;
  v_results    jsonb := '[]'::jsonb;
  v_processed  integer := 0;
BEGIN
  -- Admin-only (or service_role / cron with auth.uid() NULL).
  IF v_caller_uid IS NOT NULL AND NOT public.is_current_user_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden_admin_only');
  END IF;

  FOR v_org_id IN
    SELECT id
      FROM public.organizations
     WHERE dissolved_at       IS NOT NULL
       AND scheduled_purge_at IS NOT NULL
       AND scheduled_purge_at <= now()
     ORDER BY scheduled_purge_at ASC
     LIMIT GREATEST(p_limit, 1)
  LOOP
    BEGIN
      v_result := public.purge_dissolved_organization_data(v_org_id, false);
      v_results := v_results || jsonb_build_array(v_result);
      v_processed := v_processed + 1;
    EXCEPTION WHEN OTHERS THEN
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'ok',              false,
        'organization_id', v_org_id,
        'error',           SQLERRM
      ));
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'ok',         true,
    'processed',  v_processed,
    'ran_at',     now(),
    'results',    v_results
  );
END;
$$;

REVOKE ALL ON FUNCTION public.run_scheduled_purge_dissolved_organizations(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_scheduled_purge_dissolved_organizations(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.run_scheduled_purge_dissolved_organizations(INTEGER) TO authenticated;

COMMENT ON FUNCTION public.run_scheduled_purge_dissolved_organizations(integer) IS
  'Batch wrapper used by the daily cron job. Iterates dissolved organizations whose '
  'scheduled_purge_at has passed and calls purge_dissolved_organization_data for each.';

-- ─── 3. Verification ──────────────────────────────────────────────────────────
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'purge_dissolved_organization_data';

  ASSERT v_def IS NOT NULL,                          'FAIL: purge function not created';
  ASSERT v_def ILIKE '%row_security TO %off%',       'FAIL: must SET row_security TO off';
  ASSERT v_def ILIKE '%is_current_user_admin%',      'FAIL: admin guard missing';
  ASSERT v_def ILIKE '%purge_window_not_reached%',   'FAIL: 30-day window guard missing';
  ASSERT v_def ILIKE '%agency_event_groups%',        'FAIL: NO-ACTION FK purge missing';
  ASSERT v_def ILIKE '%calendar_entries%',           'FAIL: calendar_entries purge missing';

  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'run_scheduled_purge_dissolved_organizations';

  ASSERT v_def IS NOT NULL,                          'FAIL: batch wrapper not created';
  ASSERT v_def ILIKE '%purge_dissolved_organization_data%', 'FAIL: wrapper must call per-org RPC';
END $$;
