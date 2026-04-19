-- ============================================================================
-- 20261125 — Phase E: Invoice Email Delivery (alternative to Stripe send)
-- ============================================================================
--
-- Adds an optional e-mail delivery path for B2B invoices. Stripe remains the
-- canonical payment-collection method; e-mail is a *parallel* delivery channel
-- so an agency can send an invoice as a PDF/portal link directly to the
-- recipient's billing inbox (typical for agency_to_agency settlements or
-- agency_to_client invoices where the client prefers manual SEPA/bank transfer
-- and does not want to be onboarded as a Stripe Customer).
--
-- DESIGN NOTES (Billing system invariants — see billing-payment-invariants.mdc):
--
-- 1. Snapshot freeze contract is preserved: a draft becomes immutable on the
--    same `pending_send → sent` transition regardless of delivery method.
--    `fn_invoices_freeze_snapshot` already triggers on the status change, not
--    on a delivery-channel marker, so no trigger needs to change here.
--
-- 2. `delivery_method` is set when the invoice leaves draft status. NULL for
--    drafts and for any historical row pre-Phase-E. Once set, never changed
--    (an invoice that was sent via Stripe stays "stripe" forever; an invoice
--    that was sent via e-mail stays "email"). A separate "resend e-mail"
--    operation MUST NOT mutate this column — it only updates email_sent_at /
--    email_message_id (the e-mail delivery log).
--
-- 3. Pre-lock invariant (Phase B.4) still applies: the Edge function MUST
--    transition `draft → pending_send` BEFORE drawing next_invoice_number or
--    binding any external delivery (Stripe customer OR e-mail dispatch) so we
--    never burn an invoice number on a delivery that fails halfway.
--
-- 4. RLS: no new policies — the new columns inherit the existing per-row
--    policies on public.invoices (member-read, member-write per Phase A).
--
-- 5. Audit: `invoice_sent` action_type already covers the send-by-email path;
--    the delivery_method is captured in new_data via the existing trigger
--    `tr_invoices_log_status_change`.
--
-- 6. Stripe-webhook neutrality: rows with delivery_method='email' have NO
--    Stripe invoice ID, so the webhook handler in tryHandleB2bInvoiceEvent
--    will simply not match them (it looks up by stripe_invoice_id). No
--    changes needed there.
--
-- 7. last_stripe_failure_* (Phase C.3) is Stripe-specific by design and
--    remains NULL for email invoices; this is correct semantics — an e-mail
--    delivery failure is recorded in last_email_failure_* (this migration).
-- ============================================================================

BEGIN;

-- ─── 1. Add delivery + email tracking columns ────────────────────────────────

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS delivery_method TEXT NULL,
  ADD COLUMN IF NOT EXISTS email_recipient TEXT NULL,
  ADD COLUMN IF NOT EXISTS email_subject   TEXT NULL,
  ADD COLUMN IF NOT EXISTS email_sent_at   TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS email_message_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS last_email_failure_at     TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS last_email_failure_reason TEXT NULL;

-- ─── 2. CHECK constraint: delivery_method ∈ {stripe, email} or NULL ──────────

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_delivery_method_check;

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_delivery_method_check
  CHECK (delivery_method IS NULL OR delivery_method IN ('stripe', 'email'));

-- ─── 3. Partial index for "sent via email and waiting on payment" lookups ────
-- Used by future reconciliation/reporting (e.g. "show me all e-mailed invoices
-- that are still unpaid after 14 days"). Tiny — only invoices that took the
-- e-mail path at all.

CREATE INDEX IF NOT EXISTS invoices_email_delivery_idx
  ON public.invoices (organization_id, email_sent_at DESC)
  WHERE delivery_method = 'email';

-- ─── 4. Partial index for open e-mail delivery failures (Smart Attention) ────

CREATE INDEX IF NOT EXISTS invoices_open_email_failure_idx
  ON public.invoices (organization_id, last_email_failure_at)
  WHERE last_email_failure_at IS NOT NULL;

-- ─── 5. Documentation / column comments ──────────────────────────────────────

COMMENT ON COLUMN public.invoices.delivery_method IS
  '20261125 (Phase E): Channel through which this invoice was delivered to the recipient. '
  'NULL for drafts. ''stripe'' = sent through Stripe Hosted Invoice (collects payment). '
  '''email'' = sent as e-mail via internal mail provider (Resend); recipient receives '
  'a PDF link / portal link and pays via the agreed bank channel. Once set on '
  'pending_send → sent transition, this value is immutable for accounting integrity.';

COMMENT ON COLUMN public.invoices.email_recipient IS
  '20261125 (Phase E): Resolved recipient e-mail address used at the moment of the '
  'first e-mail send. Snapshot — does NOT update if the contact e-mail later changes.';

COMMENT ON COLUMN public.invoices.email_subject IS
  '20261125 (Phase E): Subject line used at first e-mail send (snapshot for audit).';

COMMENT ON COLUMN public.invoices.email_sent_at IS
  '20261125 (Phase E): Timestamp of the LATEST successful e-mail dispatch (resend updates '
  'this; original send time is preserved in audit_trail / invoice_events).';

COMMENT ON COLUMN public.invoices.email_message_id IS
  '20261125 (Phase E): Provider message id (Resend) of the latest successful dispatch. '
  'Used for delivery tracking + de-duplication on operator-initiated resend.';

COMMENT ON COLUMN public.invoices.last_email_failure_at IS
  '20261125 (Phase E): Timestamp of the most recent e-mail delivery failure. NULL after '
  'a subsequent successful send. Drives the invoice_payment_failed-style attention '
  'signal for the e-mail channel (operationally distinct from Stripe failures).';

COMMENT ON COLUMN public.invoices.last_email_failure_reason IS
  '20261125 (Phase E): Human-readable reason for the most recent e-mail delivery failure.';

-- ─── 6. Verification ─────────────────────────────────────────────────────────

DO $$
DECLARE
  v_columns_ok BOOLEAN;
  v_constraint_ok BOOLEAN;
BEGIN
  SELECT (
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
            AND table_name='invoices' AND column_name='delivery_method')
    AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
            AND table_name='invoices' AND column_name='email_recipient')
    AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
            AND table_name='invoices' AND column_name='email_sent_at')
    AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
            AND table_name='invoices' AND column_name='email_message_id')
    AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
            AND table_name='invoices' AND column_name='last_email_failure_at')
  ) INTO v_columns_ok;
  ASSERT v_columns_ok, 'FAIL: invoices email-delivery columns missing';

  SELECT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_schema = 'public'
      AND constraint_name   = 'invoices_delivery_method_check'
  ) INTO v_constraint_ok;
  ASSERT v_constraint_ok, 'FAIL: invoices_delivery_method_check missing';

  RAISE NOTICE '20261125 verified: email-delivery columns + check constraint installed.';
END $$;

COMMIT;
