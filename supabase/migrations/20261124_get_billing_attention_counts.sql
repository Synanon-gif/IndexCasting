-- =============================================================================
-- Migration: 20261124_get_billing_attention_counts.sql
--
-- WHY: Phase C.2 of the Billing System Evolution Audit & Hardening Pass.
-- Until now `useBillingTabBadge` loaded ALL issued invoices, ALL received
-- invoices and ALL settlements for the org just to compute a single boolean
-- "should the Billing tab show a dot?". For large agencies (hundreds or
-- thousands of invoices) that is a serious performance problem on every
-- mount of the bottom navigation.
--
-- This RPC moves the aggregation server-side and returns ONLY counts per
-- category. Payload is O(11) regardless of org size. The frontend then
-- applies role-filtering and severity-reduction (lightweight, pure JS).
--
-- INVARIANT MATCHING (must stay in lockstep with src/utils/billingAttention.ts):
--   - 11 categories (Phase C.1):
--       invoice_overdue, invoice_unpaid, invoice_draft_pending,
--       invoice_pending_send, invoice_payment_failed,
--       invoice_missing_recipient_data, invoice_received_unpaid,
--       invoice_received_overdue, settlement_draft_pending,
--       settlement_recorded_unpaid, billing_profile_missing
--   - draft_pending only fires when total_amount_cents > 0
--   - missing_recipient_data only fires for drafts with total > 0 AND
--     missing one of the 5 required snapshot keys
--   - pending_send only fires when row has been pending for >= p_stuck_minutes
--   - overdue/received_overdue derive from due_date < today OR status='overdue'
--   - payment_failed: last_stripe_failure_at NOT NULL AND status NOT IN
--       ('paid','void','uncollectible')
--
-- SECURITY MODEL:
--   - SECURITY DEFINER with `row_security TO off` (counts must be deterministic,
--     not subject to caller-side RLS quirks).
--   - First-line guards: auth.uid() must be set AND caller must be a member
--     of the org. Non-members get `not_org_member`.
--   - This is COUNTS-ONLY. No row IDs, no amounts, no recipient names — so
--     it cannot leak invoice details across orgs even though it bypasses RLS.
--   - Members (booker/employee) get the same counts as owners. The role-based
--     visibility filter (e.g. clients don't see settlement signals) is applied
--     in the frontend `useBillingTabBadge` against `billingCategoryRoles()`.
--
-- COMPATIBILITY: This is purely additive. Existing callers continue to work
-- via the legacy `mode='detailed'` path of `useBillingTabBadge`.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_billing_attention_counts(
  p_organization_id uuid,
  p_today date DEFAULT current_date,
  p_pending_send_stuck_minutes int DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_counts jsonb;
  v_stuck_threshold timestamptz := now() - make_interval(mins => GREATEST(p_pending_send_stuck_minutes, 0));
BEGIN
  -- Guard 1: authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Guard 2: caller must be a member of the org (covers owner + booker + employee).
  -- We deliberately allow members (not just owners) so booker/employee tab dots
  -- match the new permission model (Phase A).
  IF NOT public.is_org_member(p_organization_id) THEN
    RAISE EXCEPTION 'not_org_member';
  END IF;

  WITH issued AS (
    SELECT
      status,
      due_date,
      total_amount_cents,
      updated_at,
      last_stripe_failure_at,
      recipient_billing_snapshot
    FROM public.invoices
    WHERE organization_id = p_organization_id
  ),
  received AS (
    SELECT
      status,
      due_date
    FROM public.invoices
    WHERE recipient_organization_id = p_organization_id
      -- Mirrors the recipient-visibility rule in the RLS policy: recipients only
      -- ever see post-send statuses (drafts of someone else's invoice are private).
      AND status IN ('sent','overdue','paid','void','uncollectible')
  ),
  settlements AS (
    SELECT status
    FROM public.agency_model_settlements
    WHERE organization_id = p_organization_id
  ),
  profile_count AS (
    SELECT count(*)::int AS n
    FROM public.organization_billing_profiles
    WHERE organization_id = p_organization_id
  )
  SELECT jsonb_build_object(
    'invoice_overdue', (
      SELECT count(*)::int FROM issued
      WHERE status = 'overdue'
         OR (status = 'sent' AND due_date IS NOT NULL AND due_date < p_today)
    ),
    'invoice_unpaid', (
      SELECT count(*)::int FROM issued
      WHERE status = 'sent'
        AND (due_date IS NULL OR due_date >= p_today)
    ),
    'invoice_draft_pending', (
      SELECT count(*)::int FROM issued
      WHERE status = 'draft'
        AND COALESCE(total_amount_cents, 0) > 0
    ),
    'invoice_pending_send', (
      SELECT count(*)::int FROM issued
      WHERE status = 'pending_send'
        AND (updated_at IS NULL OR updated_at < v_stuck_threshold)
    ),
    'invoice_payment_failed', (
      SELECT count(*)::int FROM issued
      WHERE last_stripe_failure_at IS NOT NULL
        AND status NOT IN ('paid','void','uncollectible')
    ),
    'invoice_missing_recipient_data', (
      SELECT count(*)::int FROM issued
      WHERE status = 'draft'
        AND COALESCE(total_amount_cents, 0) > 0
        AND NOT (
          recipient_billing_snapshot IS NOT NULL
          AND nullif(trim(recipient_billing_snapshot ->> 'billing_name'), '')      IS NOT NULL
          AND nullif(trim(recipient_billing_snapshot ->> 'billing_address_1'), '') IS NOT NULL
          AND nullif(trim(recipient_billing_snapshot ->> 'billing_city'), '')      IS NOT NULL
          AND nullif(trim(recipient_billing_snapshot ->> 'billing_country'), '')   IS NOT NULL
          AND nullif(trim(recipient_billing_snapshot ->> 'billing_email'), '')     IS NOT NULL
        )
    ),
    'invoice_received_unpaid', (
      SELECT count(*)::int FROM received
      WHERE status = 'sent'
        AND (due_date IS NULL OR due_date >= p_today)
    ),
    'invoice_received_overdue', (
      SELECT count(*)::int FROM received
      WHERE status = 'overdue'
         OR (status = 'sent' AND due_date IS NOT NULL AND due_date < p_today)
    ),
    'settlement_draft_pending', (
      SELECT count(*)::int FROM settlements WHERE status = 'draft'
    ),
    'settlement_recorded_unpaid', (
      SELECT count(*)::int FROM settlements WHERE status = 'recorded'
    ),
    'billing_profile_missing', (
      SELECT CASE WHEN n = 0 THEN 1 ELSE 0 END FROM profile_count
    )
  ) INTO v_counts;

  RETURN jsonb_build_object('counts', v_counts);
END;
$$;

REVOKE ALL ON FUNCTION public.get_billing_attention_counts(uuid, date, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_billing_attention_counts(uuid, date, int) TO authenticated;

COMMENT ON FUNCTION public.get_billing_attention_counts(uuid, date, int) IS
  '20261124 (Phase C.2): Returns billing attention counts per category for an '
  'organization. Counts-only, O(11) payload. Used by useBillingTabBadge in '
  'mode=''counts'' to compute Billing tab dot without loading any invoice rows. '
  'Mirrors the categorization in src/utils/billingAttention.ts deriveBillingAttention.';

-- Verification
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_billing_attention_counts';

  ASSERT v_def IS NOT NULL,
    'FAIL: get_billing_attention_counts not created';
  ASSERT v_def ILIKE '%row_security%off%',
    'FAIL: get_billing_attention_counts missing SET row_security TO off';
  ASSERT v_def ILIKE '%is_org_member%',
    'FAIL: get_billing_attention_counts missing is_org_member guard';
  ASSERT v_def ILIKE '%invoice_payment_failed%',
    'FAIL: get_billing_attention_counts missing payment_failed category';
  ASSERT v_def ILIKE '%invoice_missing_recipient_data%',
    'FAIL: get_billing_attention_counts missing missing_recipient_data category';

  RAISE NOTICE 'PASS: 20261124_get_billing_attention_counts — all checks passed';
END $$;
