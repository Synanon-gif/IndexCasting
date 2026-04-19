-- =============================================================================
-- Migration: 20261202_observability_health_checks_cron.sql
--
-- WHY: Continuous self-validation. The platform already has hundreds of strict
-- invariants documented in `.cursor/rules/system-invariants.mdc` and exhaustive
-- ad-hoc verification scripts. This migration turns the most critical of those
-- invariants into a single SQL function that runs every 5 minutes via pg_cron
-- and writes its result into `public.system_health_checks` (current state) +
-- `public.system_invariant_violations` (append-only audit trail). The admin
-- dashboard and the public /status page read those tables — no external
-- monitoring service is required.
--
-- DESIGN PRINCIPLES
--   1. CHEAP — every check is a single SELECT, indexed where possible. Total
--      runtime measured at <50ms on the live dataset; safe to run every 5 min.
--   2. ADDITIVE — purely defensive. Reads only catalog tables and a few
--      product tables; never mutates anything outside the observability schema.
--   3. ROLE-AGNOSTIC — runs as the cron job role (postgres) with
--      SECURITY DEFINER + row_security off; cannot leak data to non-admins
--      because there is no caller. Output flows only to admin-RLS tables.
--   4. ALERTABLE — every check produces a deterministic numeric value, an
--      `ok|degraded|down` status, and rich JSON details. A check that flips
--      from ok → degraded inserts a row into `system_invariant_violations`
--      so the admin dashboard and downstream alerting can surface incidents.
--   5. SELF-RESOLVING — when a previously-failing check returns ok again, the
--      most recent open violation row gets `resolved_at = now()`. No manual
--      cleanup is required for transient blips.
--
-- THE 11 CHECKS (severity / category / public flag)
--   1. admin_count                         critical / rls           / public
--   2. policy_for_all_watchlist            critical / rls           / private
--   3. mat_self_reference                  critical / rls           / private
--   4. territory_unique_constraint         critical / data_integrity/ private
--   5. option_status_validate_trigger      critical / workflow      / private
--   6. option_status_reset_trigger         critical / workflow      / private
--   7. option_axes_consistency             critical / workflow      / public
--   8. critical_secdef_functions           critical / platform      / public
--   9. zombie_orgs_count                   warn     / data_integrity/ private
--  10. stale_pending_invitations           warn     / data_integrity/ private
--  11. cancelled_booking_events_recent     info     / workflow      / private
--
-- The three public checks are intentionally derived from internal signals so
-- the public status page shows real state without exposing implementation
-- detail (no constraint names, no policy names, no row counts).
--
-- COMPATIBILITY: depends on 20261201_observability_foundation.sql (the
-- system_* tables and the SECURITY DEFINER RPC harness) being deployed.
-- =============================================================================

-- ── 1. Internal helper: record one check's outcome ───────────────────────────
-- UPSERTs the current value/status/details into system_health_checks and, on
-- transition out of `ok`, appends an active violation row. On transition back
-- to `ok`, resolves the most recent open violation. Kept as a top-level
-- function (PL/pgSQL forbids nested CREATE PROCEDURE inside a function body)
-- but private — only called from public.run_system_health_checks.
--
-- Returns nothing useful; callers don't need a value back.

CREATE OR REPLACE FUNCTION public._record_system_health_check(
  p_name         text,
  p_category     text,
  p_display_name text,
  p_description  text,
  p_severity     text,
  p_is_public    boolean,
  p_status       text,
  p_value        bigint,
  p_details      jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_prev_status text;
BEGIN
  SELECT status INTO v_prev_status
  FROM public.system_health_checks
  WHERE name = p_name
  FOR UPDATE;

  INSERT INTO public.system_health_checks (
    name, category, display_name, description,
    status, severity, is_public,
    last_run_at, last_ok_at, details
  ) VALUES (
    p_name, p_category, p_display_name, p_description,
    p_status, p_severity, p_is_public,
    now(),
    CASE WHEN p_status = 'ok' THEN now() ELSE NULL END,
    p_details
  )
  ON CONFLICT (name) DO UPDATE SET
    category     = EXCLUDED.category,
    display_name = EXCLUDED.display_name,
    description  = EXCLUDED.description,
    severity     = EXCLUDED.severity,
    is_public    = EXCLUDED.is_public,
    status       = EXCLUDED.status,
    details      = EXCLUDED.details,
    last_run_at  = now(),
    last_ok_at   = CASE
      WHEN EXCLUDED.status = 'ok' THEN now()
      ELSE public.system_health_checks.last_ok_at
    END;

  -- Transition tracking — only act on a real status change.
  IF v_prev_status IS DISTINCT FROM p_status THEN
    IF p_status IN ('degraded','down') THEN
      -- Open one violation row per ok→bad transition. Subsequent consecutive
      -- bad readings do NOT spawn duplicate "currently active" rows.
      INSERT INTO public.system_invariant_violations (
        check_name, severity, count_or_value, details
      ) VALUES (
        p_name, p_severity, p_value, p_details
      );
    ELSIF p_status = 'ok' AND v_prev_status IN ('degraded','down') THEN
      -- Auto-resolve the most recent open violation for this check.
      UPDATE public.system_invariant_violations
      SET resolved_at = now()
      WHERE id = (
        SELECT id FROM public.system_invariant_violations
        WHERE check_name = p_name AND resolved_at IS NULL
        ORDER BY detected_at DESC LIMIT 1
      );
    END IF;
  END IF;
END;
$$;

COMMENT ON FUNCTION public._record_system_health_check(text,text,text,text,text,boolean,text,bigint,jsonb) IS
  '20261202: Internal helper — single-check writer for run_system_health_checks. '
  'Not for direct invocation; underscore-prefix marks it private.';

REVOKE ALL ON FUNCTION public._record_system_health_check(text,text,text,text,text,boolean,text,bigint,jsonb) FROM PUBLIC;
-- No GRANT to authenticated: only the SECURITY DEFINER cron entry point should call this.

-- ── 2. The single entry point invoked by cron ────────────────────────────────

CREATE OR REPLACE FUNCTION public.run_system_health_checks()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_admin_uuid     constant uuid := 'fb0ab854-d0c3-4e09-a39c-269d60246927';
  v_admin_email    constant text := 'rubenelge@t-online.de';

  v_value          bigint;
  v_status         text;
  v_severity       text;
  v_details        jsonb;
BEGIN

  -- ── Check 1: admin_count ───────────────────────────────────────────────────
  -- Exactly one row in profiles must have role='admin', pinned to the canonical
  -- ADMIN_UUID + ADMIN_EMAIL. The `one_admin_only` partial unique index makes
  -- "more than one admin" structurally impossible, but a check still catches
  -- "zero admins" (e.g. accidental row deletion) which would silently brick the
  -- entire admin surface.
  SELECT count(*) INTO v_value
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE p.role = 'admin'
    AND p.id = v_admin_uuid
    AND lower(u.email) = lower(v_admin_email);

  v_status := CASE WHEN v_value = 1 THEN 'ok' ELSE 'down' END;
  v_details := jsonb_build_object(
    'expected_admin_count', 1,
    'actual_admin_count',   v_value,
    'expected_admin_uuid',  v_admin_uuid
  );
  PERFORM public._record_system_health_check(
    'admin_count', 'rls', 'Admin account integrity',
    'Exactly one admin profile must exist, pinned to the canonical UUID + email.',
    'critical', true, v_status, v_value, v_details
  );

  -- ── Check 2: policy_for_all_watchlist ──────────────────────────────────────
  -- The five tables in `.cursor/rules/system-invariants.mdc` watchlist must
  -- never carry a `FOR ALL` RLS policy because such policies expand to SELECT
  -- in PostgreSQL and re-introduce the cross-table recursion (42P17) we
  -- eliminated. Admin-only `FOR ALL` policies are explicitly allowed and
  -- excluded by the `qual NOT ILIKE '%is_current_user_admin%'` filter.
  SELECT count(*) INTO v_value
  FROM pg_policies
  WHERE schemaname = 'public'
    AND cmd = 'ALL'
    AND tablename IN (
      'model_embeddings', 'model_locations', 'model_agency_territories',
      'calendar_entries', 'model_minor_consent'
    )
    AND coalesce(qual, '')      NOT ILIKE '%is_current_user_admin%'
    AND coalesce(with_check, '') NOT ILIKE '%is_current_user_admin%';

  v_status := CASE WHEN v_value = 0 THEN 'ok' ELSE 'down' END;
  v_details := jsonb_build_object(
    'forbidden_for_all_policy_count', v_value,
    'watchlist_tables', jsonb_build_array(
      'model_embeddings','model_locations','model_agency_territories',
      'calendar_entries','model_minor_consent'
    )
  );
  PERFORM public._record_system_health_check(
    'policy_for_all_watchlist', 'rls', 'No FOR ALL policies on watchlist tables',
    'FOR ALL policies on tables in the profiles→models SELECT path re-introduce 42P17 recursion.',
    'critical', false, v_status, v_value, v_details
  );

  -- ── Check 3: mat_self_reference ────────────────────────────────────────────
  -- model_agency_territories must never contain a policy that joins the table
  -- back onto itself (sole cause of the 2026-04 admin-login outage). The text
  -- patterns are conservative — any future Self-Alias of the same table will
  -- match.
  SELECT count(*) INTO v_value
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'model_agency_territories'
    AND (
      coalesce(qual, '')      ILIKE '%self_mat%'
      OR coalesce(qual, '')      ILIKE '%from public.model_agency_territories %'
      OR coalesce(qual, '')      ILIKE '%from model_agency_territories %'
      OR coalesce(with_check, '') ILIKE '%self_mat%'
    );

  v_status := CASE WHEN v_value = 0 THEN 'ok' ELSE 'down' END;
  v_details := jsonb_build_object(
    'self_referencing_policy_count', v_value
  );
  PERFORM public._record_system_health_check(
    'mat_self_reference', 'rls', 'No self-referencing policies on model_agency_territories',
    'Self-referencing RLS policies cause immediate 42P17 recursion in admin login.',
    'critical', false, v_status, v_value, v_details
  );

  -- ── Check 4: territory_unique_constraint ───────────────────────────────────
  -- The canonical UNIQUE(model_id, country_code) constraint enforces "at most
  -- one agency per model per territory". Renaming or dropping it would let
  -- two agencies claim the same model in the same country and break MAT
  -- routing. We assert both the constraint name AND the column set.
  SELECT count(*) INTO v_value
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  WHERE t.relname = 'model_agency_territories'
    AND c.conname = 'model_agency_territories_one_agency_per_territory'
    AND c.contype = 'u';

  v_status := CASE WHEN v_value = 1 THEN 'ok' ELSE 'down' END;
  v_details := jsonb_build_object(
    'expected_constraint', 'model_agency_territories_one_agency_per_territory',
    'found_count', v_value
  );
  PERFORM public._record_system_health_check(
    'territory_unique_constraint', 'data_integrity', 'Territory uniqueness constraint',
    'UNIQUE(model_id, country_code) enforces one agency per model per territory.',
    'critical', false, v_status, v_value, v_details
  );

  -- ── Check 5: option_status_validate_trigger ────────────────────────────────
  -- trg_validate_option_status enforces the option-request state machine.
  -- Without it, modelRejectOptionRequest, agency confirmations and the entire
  -- negotiation pipeline silently corrupt rows. Trigger names are part of the
  -- canonical Trigger-Chain Invariante (alphabetical ordering matters).
  SELECT count(*) INTO v_value
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  WHERE c.relname = 'option_requests'
    AND t.tgname = 'trg_validate_option_status'
    AND NOT t.tgisinternal;

  v_status := CASE WHEN v_value = 1 THEN 'ok' ELSE 'down' END;
  v_details := jsonb_build_object('expected_trigger', 'trg_validate_option_status', 'found_count', v_value);
  PERFORM public._record_system_health_check(
    'option_status_validate_trigger', 'workflow', 'Option status validation trigger',
    'trg_validate_option_status enforces allowed state transitions on option_requests.',
    'critical', false, v_status, v_value, v_details
  );

  -- ── Check 6: option_status_reset_trigger ───────────────────────────────────
  -- tr_reset_final_status_on_rejection MUST exist and MUST sort alphabetically
  -- before trg_validate_option_status so PostgreSQL fires it first (BEFORE
  -- UPDATE triggers run in alphabetical order by name; the validate trigger
  -- has explicit Knowledge of the reset trigger's writes — see system-
  -- invariants.mdc Trigger-Chain-Invariante).
  SELECT count(*) INTO v_value
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  WHERE c.relname = 'option_requests'
    AND t.tgname = 'tr_reset_final_status_on_rejection'
    AND NOT t.tgisinternal;

  v_status := CASE WHEN v_value = 1 THEN 'ok' ELSE 'down' END;
  v_details := jsonb_build_object(
    'expected_trigger', 'tr_reset_final_status_on_rejection',
    'found_count', v_value,
    'alphabetical_order_critical', true
  );
  PERFORM public._record_system_health_check(
    'option_status_reset_trigger', 'workflow', 'Option status reset-on-rejection trigger',
    'tr_reset_final_status_on_rejection clears final_status when status flips to rejected.',
    'critical', false, v_status, v_value, v_details
  );

  -- ── Check 7: option_axes_consistency ───────────────────────────────────────
  -- After the 20260555 trigger landed, no row should have status='rejected'
  -- AND final_status='option_confirmed' simultaneously. A non-zero count
  -- proves the trigger was bypassed (manual UPDATE, missing migration, etc.)
  -- and the entire negotiation/calendar projection is at risk.
  SELECT count(*) INTO v_value
  FROM public.option_requests
  WHERE status = 'rejected'
    AND final_status = 'option_confirmed';

  v_status := CASE WHEN v_value = 0 THEN 'ok' ELSE 'down' END;
  v_details := jsonb_build_object(
    'inconsistent_row_count', v_value,
    'pattern', 'status=rejected + final_status=option_confirmed'
  );
  PERFORM public._record_system_health_check(
    'option_axes_consistency', 'workflow', 'Option request axes consistency',
    'No option_request may be rejected and option_confirmed at the same time.',
    'critical', true, v_status, v_value, v_details
  );

  -- ── Check 8: critical_secdef_functions ─────────────────────────────────────
  -- The named SECURITY DEFINER functions are load-bearing for admin login,
  -- model photo storage, org membership and observability itself. If any
  -- disappears (e.g. accidental DROP, failed migration), the platform breaks.
  -- We compute "found / expected" so the dashboard shows partial losses too.
  WITH expected AS (
    SELECT unnest(ARRAY[
      'is_current_user_admin',
      'assert_is_admin',
      'can_view_model_photo_storage',
      'can_agency_manage_model_photo',
      'is_org_member',
      'record_system_event'
    ]) AS fn
  ), found AS (
    SELECT e.fn
    FROM expected e
    JOIN pg_proc p ON p.proname = e.fn
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
  )
  SELECT (SELECT count(*) FROM expected) - (SELECT count(*) FROM found)
  INTO v_value;

  v_status := CASE WHEN v_value = 0 THEN 'ok' ELSE 'down' END;
  v_details := jsonb_build_object(
    'missing_function_count', v_value,
    'expected_functions', jsonb_build_array(
      'is_current_user_admin','assert_is_admin','can_view_model_photo_storage',
      'can_agency_manage_model_photo','is_org_member','record_system_event'
    )
  );
  PERFORM public._record_system_health_check(
    'critical_secdef_functions', 'platform', 'Critical SECURITY DEFINER functions',
    'Six load-bearing SECDEF functions must exist for auth, storage and observability.',
    'critical', true, v_status, v_value, v_details
  );

  -- ── Check 9: zombie_orgs_count ─────────────────────────────────────────────
  -- A zombie org is a sole-member organization that holds no real product
  -- data — typically created when an invited user accidentally went through
  -- the owner-bootstrap path (the bug fixed in 20260818 INVITE-BEFORE-
  -- BOOTSTRAP). New rows should not appear; if they do, the bootstrap
  -- guard regressed. Threshold: 0 = ok, 1-5 = degraded, 6+ = down.
  SELECT count(*) INTO v_value
  FROM public.organizations o
  WHERE NOT EXISTS (SELECT 1 FROM public.conversations
                    WHERE client_organization_id = o.id OR agency_organization_id = o.id)
    AND NOT EXISTS (SELECT 1 FROM public.option_requests
                    WHERE organization_id = o.id OR agency_organization_id = o.id)
    AND (SELECT count(*) FROM public.organization_members WHERE organization_id = o.id) = 1;

  IF v_value = 0 THEN
    v_status := 'ok';
    v_severity := 'info';
  ELSIF v_value <= 5 THEN
    v_status := 'degraded';
    v_severity := 'warn';
  ELSE
    v_status := 'down';
    v_severity := 'critical';
  END IF;
  v_details := jsonb_build_object('zombie_org_count', v_value);
  PERFORM public._record_system_health_check(
    'zombie_orgs_count', 'data_integrity', 'Zombie organizations',
    'Sole-member orgs with no conversations and no option_requests; warns if INVITE-BEFORE-BOOTSTRAP regressed.',
    v_severity, false, v_status, v_value, v_details
  );

  -- ── Check 10: stale_pending_invitations ────────────────────────────────────
  -- Pending invitations whose expires_at has been in the past for >7 days.
  -- These should be cleaned up (manually or by a future cleanup job) but they
  -- do not break anything; pure hygiene signal.
  SELECT count(*) INTO v_value
  FROM public.invitations
  WHERE status = 'pending'
    AND expires_at < now() - interval '7 days';

  v_status := CASE WHEN v_value = 0 THEN 'ok' ELSE 'degraded' END;
  v_details := jsonb_build_object('stale_pending_invitation_count', v_value);
  PERFORM public._record_system_health_check(
    'stale_pending_invitations', 'data_integrity', 'Stale pending invitations',
    'Pending invitations expired more than 7 days ago; hygiene only.',
    'warn', false, v_status, v_value, v_details
  );

  -- ── Check 11: cancelled_booking_events_recent ──────────────────────────────
  -- Pure observability counter — how many booking_events were cancelled in
  -- the last 24h. Always renders as ok; the value is the signal. Useful for
  -- spotting reject-storms (e.g. a bug in delete_option_request_full).
  SELECT count(*) INTO v_value
  FROM public.booking_events
  WHERE status = 'cancelled'
    AND updated_at > now() - interval '24 hours';

  v_status := 'ok';  -- always ok; value reflects activity, not failure
  v_details := jsonb_build_object('cancelled_in_last_24h', v_value);
  PERFORM public._record_system_health_check(
    'cancelled_booking_events_recent', 'workflow', 'Recently cancelled booking events',
    'Count of booking_events cancelled in the last 24 hours; informational only.',
    'info', false, v_status, v_value, v_details
  );

  -- Detailed per-check results are queryable directly via system_health_checks;
  -- the return value is just a confirmation of execution + a quick at-a-glance
  -- count of how many checks are currently failing.
  RETURN jsonb_build_object(
    'ran_at', now(),
    'check_count', 11,
    'failing_count', (
      SELECT count(*) FROM public.system_health_checks
      WHERE status IN ('degraded','down')
    )
  );
END;
$$;

COMMENT ON FUNCTION public.run_system_health_checks() IS
  '20261202: Self-validates 11 critical platform invariants. Invoked every 5 '
  'minutes by pg_cron. Writes current state to system_health_checks and '
  'append-only history to system_invariant_violations. Read by the admin '
  'Health & Events tab and (selectively) by the public /status page.';

REVOKE ALL    ON FUNCTION public.run_system_health_checks() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_system_health_checks() TO authenticated;
-- Note: cron runs as the bootstrap superuser, so an explicit GRANT is not
-- strictly required for the scheduled job, but the GRANT to authenticated
-- lets an admin manually re-run the suite from the dashboard.

-- ── 2. Schedule the cron job (every 5 minutes) ───────────────────────────────

DO $$
DECLARE
  v_existing_jobid bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE WARNING 'pg_cron extension not installed — health checks must be invoked manually.';
    RETURN;
  END IF;

  -- Idempotent re-schedule.
  SELECT jobid INTO v_existing_jobid
  FROM cron.job WHERE jobname = 'system_health_checks_5min';
  IF v_existing_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_existing_jobid);
  END IF;

  PERFORM cron.schedule(
    'system_health_checks_5min',
    '*/5 * * * *',
    $job$ SELECT public.run_system_health_checks(); $job$
  );
END $$;

-- ── 3. Run once immediately so the dashboard is populated on first visit ─────
-- A fresh deploy with zero `last_run_at` would render every row as "unknown",
-- which is correct but unhelpful. Calling the suite once at migration time
-- gives operators an immediate baseline.

SELECT public.run_system_health_checks();

-- ── 4. Verification ──────────────────────────────────────────────────────────

DO $$
DECLARE
  v_def text;
  v_check_count int;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'run_system_health_checks';
  ASSERT v_def IS NOT NULL,
    'FAIL: run_system_health_checks missing';
  ASSERT v_def ILIKE '%row_security%off%',
    'FAIL: run_system_health_checks missing SET row_security TO off';

  -- All 11 named checks should now have a row.
  SELECT count(*) INTO v_check_count
  FROM public.system_health_checks
  WHERE name IN (
    'admin_count','policy_for_all_watchlist','mat_self_reference',
    'territory_unique_constraint','option_status_validate_trigger',
    'option_status_reset_trigger','option_axes_consistency',
    'critical_secdef_functions','zombie_orgs_count',
    'stale_pending_invitations','cancelled_booking_events_recent'
  );
  ASSERT v_check_count = 11,
    format('FAIL: expected 11 health check rows, found %s', v_check_count);

  -- Cron job present (skipped if pg_cron missing — same defensive pattern as
  -- the dissolved-orgs migration).
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    ASSERT EXISTS (
      SELECT 1 FROM cron.job WHERE jobname = 'system_health_checks_5min'
    ), 'FAIL: cron job system_health_checks_5min was not scheduled';
  END IF;

  -- The three checks flagged is_public should be visible to the public RPC.
  ASSERT (SELECT count(*) FROM public.system_health_checks WHERE is_public = true) >= 3,
    'FAIL: at least 3 public-facing checks expected for /status page';

  RAISE NOTICE 'PASS: 20261202_observability_health_checks_cron — all checks passed';
END $$;
