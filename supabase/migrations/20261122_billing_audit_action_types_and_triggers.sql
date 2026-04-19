-- =============================================================================
-- Migration: 20261122_billing_audit_action_types_and_triggers.sql
--
-- WHY: Phase B.5 of the Billing System Evolution Audit & Hardening Pass.
-- The new billing surface (invoices, settlements) creates and mutates legal
-- accounting records. Every billing mutation MUST land in audit_trail so that
-- accounting/security can answer "who did what when?" — independent of the UI.
--
-- Two complementary audit pathways:
--
-- 1. FRONTEND-INITIATED (source='api')
--    Service-layer wrappers (invoicesSupabase, agencyModelSettlementsSupabase)
--    call logAction() after a successful mutation. Needs new action_type values
--    in the CHECK constraint.
--
-- 2. WEBHOOK / SYSTEM-INITIATED (source='trigger')
--    Stripe webhook (running as service_role, auth.uid() = NULL) writes
--    invoices.status transitions (sent → paid → payment_failed → void).
--    A normal log_audit_action call from such a trigger would hit
--    'permission_denied' because the caller is neither admin nor org member.
--    Solution: a dedicated SECURITY DEFINER helper
--    public.log_billing_audit_from_trigger(...) that skips the membership
--    check and forces source='trigger'. It is REVOKEd from PUBLIC/anon and
--    only callable from inside the DB trigger (never from PostgREST).
--
-- This migration is additive and idempotent. It does NOT modify
-- log_audit_action(); existing audit pipelines are untouched.
-- =============================================================================


-- ─── 1. Extend audit_trail.action_type CHECK with billing actions ────────────
-- Keep all previously allowed values from 20260553 + add billing actions.

ALTER TABLE public.audit_trail DROP CONSTRAINT IF EXISTS audit_trail_action_type_check;

ALTER TABLE public.audit_trail
  ADD CONSTRAINT audit_trail_action_type_check CHECK (action_type IN (
    -- GDPR
    'user_deleted', 'user_deletion_requested', 'user_deletion_cancelled',
    'org_deleted', 'data_exported',
    -- Bookings
    'booking_created', 'booking_confirmed', 'booking_cancelled',
    'booking_agency_accepted', 'booking_model_confirmed', 'booking_completed',
    -- Price / option negotiations
    'option_sent', 'option_price_proposed', 'option_price_countered',
    'option_price_accepted', 'option_price_rejected',
    'option_confirmed', 'option_rejected',
    'option_schedule_updated', 'option_document_uploaded',
    'option_request_deleted',
    -- Recruiting / Casting
    'application_accepted', 'application_rejected',
    -- Profile edits
    'profile_updated', 'model_created', 'model_updated', 'model_removed',
    'model_visibility_changed',
    -- Image rights
    'image_rights_confirmed', 'image_uploaded', 'image_deleted',
    -- Minor consent
    'minor_flagged', 'minor_guardian_consent', 'minor_agency_confirmed',
    -- Team
    'member_invited', 'member_removed', 'member_role_changed',
    -- Admin
    'admin_override', 'admin_profile_updated', 'admin_subscription_changed',
    -- Security
    'login_failed', 'permission_denied', 'suspicious_activity',
    -- ─── Billing (NEW 20261122) ─────────────────────────────────────────────
    -- Invoice draft lifecycle (frontend, source='api')
    'invoice_draft_created', 'invoice_draft_updated', 'invoice_draft_deleted',
    'invoice_line_added',    'invoice_line_updated',  'invoice_line_deleted',
    -- Invoice send/payment lifecycle (DB trigger from Stripe webhook, source='trigger')
    'invoice_sent', 'invoice_paid', 'invoice_payment_failed',
    'invoice_voided', 'invoice_overdue', 'invoice_uncollectible',
    -- Settlements (agency ↔ model)
    'settlement_created', 'settlement_updated', 'settlement_deleted',
    'settlement_marked_recorded', 'settlement_marked_paid',
    'settlement_item_added', 'settlement_item_deleted'
  ));


-- ─── 2. Internal helper for trigger-originated billing audit ─────────────────
-- WHY a separate function (not log_audit_action):
--   - Stripe webhook writes invoices.status as service_role; auth.uid() is NULL.
--   - log_audit_action enforces "caller is admin OR member of p_org_id",
--     which would always fail in this context.
--   - This helper has no membership check (it can ONLY be called from inside
--     a DB trigger — REVOKEd from PUBLIC/anon/authenticated).
--   - It hard-codes source='trigger' and actor=NULL (system action).
--   - row_security TO off so it can write audit_trail without RLS surprises.

CREATE OR REPLACE FUNCTION public.log_billing_audit_from_trigger(
  p_org_id      UUID,
  p_action_type TEXT,
  p_entity_id   UUID,
  p_old_data    JSONB DEFAULT NULL,
  p_new_data    JSONB DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
BEGIN
  -- No caller-context check on purpose: this is invoked from BEFORE/AFTER
  -- triggers running under service_role (Stripe webhook) where auth.uid() is NULL.
  -- Function is REVOKEd below so it cannot be called via PostgREST.
  INSERT INTO public.audit_trail (
    user_id,
    org_id,
    action_type,
    entity_type,
    entity_id,
    old_data,
    new_data,
    ip_address,
    source,
    created_at
  ) VALUES (
    NULL,                -- system action (no human actor)
    p_org_id,
    p_action_type,
    'invoice',
    p_entity_id,
    p_old_data,
    p_new_data,
    NULL,
    'trigger',
    NOW()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.log_billing_audit_from_trigger(UUID, TEXT, UUID, JSONB, JSONB)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.log_billing_audit_from_trigger IS
  'Internal trigger helper (20261122) for billing audit. SECURITY DEFINER, no '
  'caller-membership check, source=trigger, actor=NULL. REVOKEd from PostgREST. '
  'Called only from tr_invoices_log_status_change.';


-- ─── 3. Trigger: log every invoices.status transition ────────────────────────
-- Fires AFTER UPDATE OF status. Captures the canonical lifecycle the
-- Stripe webhook drives (draft → pending_send → sent → paid / payment_failed
-- / overdue / void / uncollectible). Frontend-driven status writes (e.g. the
-- Edge function locking draft → pending_send) are also captured here, so we
-- have a single source of truth for invoice state changes regardless of who
-- initiated them.

CREATE OR REPLACE FUNCTION public.fn_log_invoice_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_action TEXT;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  v_action := CASE NEW.status
    WHEN 'sent'           THEN 'invoice_sent'
    WHEN 'paid'           THEN 'invoice_paid'
    WHEN 'payment_failed' THEN 'invoice_payment_failed'
    WHEN 'void'           THEN 'invoice_voided'
    WHEN 'overdue'        THEN 'invoice_overdue'
    WHEN 'uncollectible'  THEN 'invoice_uncollectible'
    ELSE NULL
  END;

  -- Only log meaningful billing-lifecycle transitions. Internal moves like
  -- draft → pending_send are not audited here (the frontend service layer
  -- emits 'invoice_draft_created' / 'invoice_sent' independently when it
  -- successfully kicks off Stripe).
  IF v_action IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM public.log_billing_audit_from_trigger(
    p_org_id      := NEW.organization_id,
    p_action_type := v_action,
    p_entity_id   := NEW.id,
    p_old_data    := jsonb_build_object('status', OLD.status),
    p_new_data    := jsonb_build_object('status', NEW.status, 'invoice_number', NEW.invoice_number)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_invoices_log_status_change ON public.invoices;
CREATE TRIGGER tr_invoices_log_status_change
  AFTER UPDATE OF status ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_log_invoice_status_change();

COMMENT ON FUNCTION public.fn_log_invoice_status_change IS
  '20261122: Audit trigger that logs every meaningful invoices.status transition '
  '(sent/paid/payment_failed/void/overdue/uncollectible). Uses '
  'log_billing_audit_from_trigger so it works under service_role (Stripe webhook).';


-- ─── 4. Verification ─────────────────────────────────────────────────────────
DO $$
DECLARE
  v_constraint_ok boolean;
  v_helper_ok     boolean;
  v_trigger_ok    boolean;
BEGIN
  -- New billing action_types are in the CHECK constraint
  SELECT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_schema = 'public'
      AND constraint_name   = 'audit_trail_action_type_check'
      AND check_clause ILIKE '%invoice_draft_created%'
      AND check_clause ILIKE '%settlement_marked_paid%'
  ) INTO v_constraint_ok;
  ASSERT v_constraint_ok,
    'FAIL: audit_trail_action_type_check missing new billing action types';

  -- Helper exists and is REVOKEd from PUBLIC
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'log_billing_audit_from_trigger'
      AND p.prosecdef = true
  ) INTO v_helper_ok;
  ASSERT v_helper_ok,
    'FAIL: log_billing_audit_from_trigger missing or not SECURITY DEFINER';

  -- Trigger exists on invoices
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    WHERE c.relname = 'invoices'
      AND t.tgname  = 'tr_invoices_log_status_change'
      AND NOT t.tgisinternal
  ) INTO v_trigger_ok;
  ASSERT v_trigger_ok,
    'FAIL: tr_invoices_log_status_change not installed on public.invoices';

  RAISE NOTICE 'PASS: 20261122_billing_audit_action_types_and_triggers — all checks passed';
END $$;
