-- =============================================================================
-- Migration C: Daily cron job for automated 30-day org-purge
--
-- Schedules a single daily job that calls
--   public.run_scheduled_purge_dissolved_organizations(p_limit => 25)
-- which iterates over orgs whose scheduled_purge_at has passed and hard-purges
-- their data via public.purge_dissolved_organization_data (Migration B).
--
-- Why daily and not hourly?
--   The 30-day window is generous; a 24-hour granularity for the actual
--   purge moment is well within Art. 17 expectations. Daily also keeps
--   operational noise low and gives ops a clean audit signal.
--
-- Idempotent: re-running the migration unschedules the previous job (if any)
-- and reschedules under the same name.
--
-- Manual trigger (admin):
--   SELECT public.run_scheduled_purge_dissolved_organizations(50);
-- =============================================================================

DO $$
DECLARE
  v_existing_jobid bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) THEN
    RAISE WARNING 'pg_cron extension not installed — skipping cron schedule. '
                  'Run public.run_scheduled_purge_dissolved_organizations() manually '
                  'or install pg_cron and re-run this migration.';
    RETURN;
  END IF;

  -- Unschedule any previous job with this name (idempotency).
  SELECT jobid INTO v_existing_jobid
    FROM cron.job
   WHERE jobname = 'purge_dissolved_organizations_daily';

  IF v_existing_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_existing_jobid);
  END IF;

  -- Schedule: every day at 03:17 UTC (off-peak, avoids midnight clustering).
  PERFORM cron.schedule(
    'purge_dissolved_organizations_daily',
    '17 3 * * *',
    $job$ SELECT public.run_scheduled_purge_dissolved_organizations(25); $job$
  );
END $$;

-- ─── Verification ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    ASSERT EXISTS (
      SELECT 1 FROM cron.job WHERE jobname = 'purge_dissolved_organizations_daily'
    ), 'FAIL: cron job was not scheduled';
  END IF;
END $$;
