-- =============================================================================
-- Stripe Webhook Idempotency — 2026-04 Security Hardening
--
-- Closes replay-attack window in the stripe-webhook Edge Function:
--
--   REPLAY-01 (HIGH): constructEventAsync validates the Stripe signature and
--     timestamp (default 300-second tolerance window). Within that window,
--     the same event payload can be delivered and processed multiple times
--     by Stripe retry logic, network duplicates, or deliberate replay. This
--     can cause double-subscription activations, double plan upgrades, etc.
--     Fix: persist the Stripe event.id after first successful processing.
--          Subsequent deliveries of the same event.id return 200 immediately
--          (idempotent acknowledgement) without re-running business logic.
--
-- Table: stripe_processed_events
--   event_id     – Stripe's globally-unique event identifier (evt_…)
--   processed_at – UTC timestamp of first successful processing
--
-- Retention: rows older than 30 days are automatically purged by a scheduled
--   Supabase cron job or pg_cron (set up separately). 30 days comfortably
--   exceeds Stripe's retry window (72 hours / 3 days).
--
-- RLS: Table is intentionally NOT accessible via the public schema anon/authenticated
--   roles. Only the service_role key (Edge Function) may read/write. The RLS
--   policies below reflect this by granting NO access to non-service roles.
--   (The Edge Function uses service_role and bypasses RLS entirely.)
--
-- Run AFTER migration_access_gate_enforcement.sql.
-- Idempotent.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.stripe_processed_events (
  event_id     TEXT        PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for range-delete pruning (TTL cleanup)
CREATE INDEX IF NOT EXISTS idx_stripe_processed_events_processed_at
  ON public.stripe_processed_events (processed_at);

-- Enable RLS — no policy for anon/authenticated means the table is invisible
-- to all JWT callers. The service_role key bypasses RLS completely, which is
-- the only caller path (Edge Function). This is intentional.
ALTER TABLE public.stripe_processed_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.stripe_processed_events IS
  'Idempotency log for Stripe webhook events. '
  'Stores event_id of each successfully processed Stripe event to prevent '
  'duplicate processing within Stripe''s retry / replay window. '
  'Accessible only via service_role (Edge Function). '
  'REPLAY-01 fix 2026-04 audit.';

COMMENT ON COLUMN public.stripe_processed_events.event_id IS
  'Stripe event identifier (evt_…). Primary key — INSERT fails on duplicate.';

COMMENT ON COLUMN public.stripe_processed_events.processed_at IS
  'UTC timestamp of first successful processing. Used for TTL cleanup.';


-- ─── Optional: Automatic 30-day pruning via pg_cron ─────────────────────────
--
-- Uncomment and run once if pg_cron is enabled on the Supabase project.
-- This keeps the table small (Stripe retries at most for 3 days).
--
-- SELECT cron.schedule(
--   'prune_stripe_processed_events',
--   '0 3 * * *',   -- daily at 03:00 UTC
--   $$
--     DELETE FROM public.stripe_processed_events
--     WHERE processed_at < now() - INTERVAL '30 days'
--   $$
-- );
