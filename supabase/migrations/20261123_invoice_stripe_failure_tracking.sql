-- =============================================================================
-- Migration: 20261123_invoice_stripe_failure_tracking.sql
--
-- WHY: Phase C.3 of the Billing System Evolution Audit & Hardening Pass.
-- Until now Stripe `invoice.payment_failed` events were merely mapped to
-- `invoices.status = 'overdue'`. That conflated two distinct semantics:
--
--   (a) "Payment due date passed" (calendar-overdue)
--   (b) "Stripe charge attempt failed" (operational failure — usually a card
--       decline that the agency / accounting team must act on quickly)
--
-- These two states are NOT the same and the Smart Attention layer (Phase C.1)
-- needs to distinguish them so accounting sees a `payment_failed` critical
-- signal independent of the calendar `overdue` signal. We track the failure
-- on dedicated columns so the canonical `status` enum stays untouched and the
-- AFTER UPDATE OF status audit trigger keeps working unchanged.
--
-- CHANGES (additive, idempotent):
--   1. ADD COLUMN public.invoices.last_stripe_failure_at  TIMESTAMPTZ NULL
--   2. ADD COLUMN public.invoices.last_stripe_failure_reason TEXT NULL
--   3. Partial index on (organization_id, last_stripe_failure_at) WHERE not null
--      → fast Smart Attention scan for active failures per org.
--
-- The Stripe webhook is updated in lockstep (supabase/functions/stripe-webhook)
-- to set these fields on `invoice.payment_failed` and to clear them on
-- `invoice.paid` / `invoice.voided`. The webhook continues to mirror the
-- canonical lifecycle into `invoices.status` exactly as before.
-- =============================================================================

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS last_stripe_failure_at     TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS last_stripe_failure_reason TEXT        NULL;

COMMENT ON COLUMN public.invoices.last_stripe_failure_at IS
  '20261123: Timestamp of the most recent Stripe invoice.payment_failed event '
  '(card decline, source error, etc.). Set by stripe-webhook. Cleared on '
  'invoice.paid / invoice.voided. NULL = no recent failure. Drives the '
  'invoice_payment_failed Smart Attention category.';

COMMENT ON COLUMN public.invoices.last_stripe_failure_reason IS
  '20261123: Optional human-readable failure reason from Stripe '
  '(last_finalization_error.message or charge.failure_message). For UI / audit.';

-- Smart Attention scans "all open Stripe failures for this org" frequently.
-- A small partial index keeps that O(failed) instead of O(all invoices).
CREATE INDEX IF NOT EXISTS invoices_open_stripe_failure_idx
  ON public.invoices (organization_id, last_stripe_failure_at)
  WHERE last_stripe_failure_at IS NOT NULL;

-- Verification
DO $$
DECLARE
  v_col_at_ok     boolean;
  v_col_reason_ok boolean;
  v_index_ok      boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'invoices'
      AND column_name = 'last_stripe_failure_at'
  ) INTO v_col_at_ok;
  ASSERT v_col_at_ok, 'FAIL: invoices.last_stripe_failure_at missing';

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'invoices'
      AND column_name = 'last_stripe_failure_reason'
  ) INTO v_col_reason_ok;
  ASSERT v_col_reason_ok, 'FAIL: invoices.last_stripe_failure_reason missing';

  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'invoices_open_stripe_failure_idx'
  ) INTO v_index_ok;
  ASSERT v_index_ok, 'FAIL: invoices_open_stripe_failure_idx missing';

  RAISE NOTICE 'PASS: 20261123_invoice_stripe_failure_tracking — all checks passed';
END $$;
