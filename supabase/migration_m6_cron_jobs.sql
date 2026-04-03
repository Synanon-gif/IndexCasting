-- MIGRATION M6: Activate pg_cron cleanup jobs
--
-- gdpr-daily-cleanup (jobid=1) already exists and runs daily at 03:00 UTC.
-- This migration adds the two remaining scheduled cleanup jobs:
--   1. cleanup_anon_rate_limits  — hourly, removes stale rate-limit windows
--   2. prune_stripe_processed_events — daily, removes events older than 30 days

-- ── 1. Hourly anon rate-limit cleanup ────────────────────────────────────────
-- Idempotent: remove existing job if present, then schedule fresh.
DO $d1$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-anon-rate-limits') THEN
    PERFORM cron.unschedule('cleanup-anon-rate-limits');
  END IF;
END $d1$;

SELECT cron.schedule(
  'cleanup-anon-rate-limits',
  '*/30 * * * *',
  'SELECT public.cleanup_anon_rate_limits()'
);

-- ── 2. Daily Stripe processed-events pruning ─────────────────────────────────
-- stripe_processed_events keeps idempotency keys; 30-day TTL is sufficient.
-- Only schedule if the table exists (defensive guard).
DO $outer$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name   = 'stripe_processed_events'
  )   THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prune-stripe-processed-events') THEN
      PERFORM cron.unschedule('prune-stripe-processed-events');
    END IF;
    PERFORM cron.schedule(
      'prune-stripe-processed-events',
      '0 4 * * *',
      'DELETE FROM public.stripe_processed_events WHERE processed_at < now() - INTERVAL ''30 days'''
    );
  END IF;
END $outer$;

-- ── Verify ───────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM cron.job
  WHERE jobname IN (
    'gdpr-daily-cleanup',
    'cleanup-anon-rate-limits',
    'prune-stripe-processed-events'
  ) AND active = true;

  IF v_count < 2 THEN
    RAISE EXCEPTION 'Expected at least 2 active cron jobs, found %', v_count;
  END IF;
END $$;
