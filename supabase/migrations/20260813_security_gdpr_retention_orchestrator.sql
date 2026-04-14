-- F-22 Security fix: Deploy the GDPR retention cleanup orchestrator to migrations/.
-- The pg_cron job (jobid 1) calls gdpr_run_all_retention_cleanup() daily at 3:00 AM,
-- but the function was only in root-SQL — not deployed to production.
-- This migration ensures it exists and is callable by the cron job.
--
-- Also ensures all sub-functions are in migrations/ for new deployments.

-- Sub-function 1: Purge expired deletion requests (30+ days)
CREATE OR REPLACE FUNCTION public.gdpr_purge_expired_deletions()
RETURNS TABLE(purged_user_id uuid, purged_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
BEGIN
  FOR v_uid IN
    SELECT id FROM public.profiles
    WHERE deletion_requested_at IS NOT NULL
      AND deletion_requested_at < now() - INTERVAL '30 days'
      AND is_active = false
  LOOP
    UPDATE public.profiles
    SET email = 'deleted_' || v_uid::text,
        display_name = 'Deleted User',
        company_name = NULL,
        deletion_requested_at = NULL,
        is_active = false
    WHERE id = v_uid;

    purged_user_id := v_uid;
    purged_at := now();
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.gdpr_purge_expired_deletions() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.gdpr_purge_expired_deletions() FROM authenticated;

-- Sub-function 2: Purge old audit trail (> 7 years)
CREATE OR REPLACE FUNCTION public.gdpr_purge_old_audit_trail()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count BIGINT;
BEGIN
  DELETE FROM public.audit_trail
  WHERE created_at < now() - INTERVAL '7 years';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.gdpr_purge_old_audit_trail() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.gdpr_purge_old_audit_trail() FROM authenticated;

-- Sub-function 3: Purge old security events (> 2 years)
CREATE OR REPLACE FUNCTION public.gdpr_purge_old_security_events()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count BIGINT;
BEGIN
  DELETE FROM public.security_events
  WHERE created_at < now() - INTERVAL '2 years';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.gdpr_purge_old_security_events() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.gdpr_purge_old_security_events() FROM authenticated;

-- Sub-function 4: Purge old guest link access log (> 1 year)
CREATE OR REPLACE FUNCTION public.gdpr_purge_old_guest_link_access_log()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count BIGINT;
BEGIN
  DELETE FROM public.guest_link_access_log
  WHERE created_at < now() - INTERVAL '1 year';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.gdpr_purge_old_guest_link_access_log() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.gdpr_purge_old_guest_link_access_log() FROM authenticated;

-- Orchestrator: calls all sub-functions
CREATE OR REPLACE FUNCTION public.gdpr_run_all_retention_cleanup()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expired_users   BIGINT := 0;
  v_old_audit       BIGINT := 0;
  v_old_sec_events  BIGINT := 0;
  v_old_gl_log      BIGINT := 0;
BEGIN
  SELECT COUNT(*) INTO v_expired_users
  FROM public.gdpr_purge_expired_deletions();

  SELECT public.gdpr_purge_old_audit_trail() INTO v_old_audit;

  SELECT public.gdpr_purge_old_security_events() INTO v_old_sec_events;

  SELECT public.gdpr_purge_old_guest_link_access_log() INTO v_old_gl_log;

  RETURN jsonb_build_object(
    'run_at',              now(),
    'expired_users',       v_expired_users,
    'old_audit_trail',     v_old_audit,
    'old_security_events', v_old_sec_events,
    'old_guest_link_log',  v_old_gl_log
  );
END;
$$;

REVOKE ALL ON FUNCTION public.gdpr_run_all_retention_cleanup() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.gdpr_run_all_retention_cleanup() FROM authenticated;

COMMENT ON FUNCTION public.gdpr_run_all_retention_cleanup IS
  'Master retention cleanup orchestrator. '
  'Called daily by pg_cron at 03:00 UTC. '
  'Returns a JSONB summary of purged rows per category. '
  'service_role only — not callable by authenticated users.';
