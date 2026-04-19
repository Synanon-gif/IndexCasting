-- =====================================================================
-- Invoices Audit Hardening — Phase 2 (F2.1, F2.3, F2.4, F2.7, F2.8)
-- Date: 2026-11-04
--
-- ⚠️  REGRESSION + FIX: the F2.7 redefinition of fn_create_agency_client_invoice_draft
--    in this migration referenced columns that DO NOT EXIST on the live
--    invoices / invoice_line_items tables (subtotal_amount, tax_amount,
--    total_amount, created_by_user_id, unit_amount, line_total_amount).
--    The trigger silently failed (caught by EXCEPTION WHEN OTHERS) and no
--    auto-draft invoices were created. Fixed in the immediately-following
--    migration 20261105_fix_invoice_draft_trigger_columns.sql, which restores
--    the correct *_cents / created_by columns AND keeps the F2.7 improvements
--    (richer warning + unique_violation handling) AND restores the original
--    is_agency_only skip / due_date / description / invoice_events behaviour
--    that this file accidentally dropped.
--
--    The other pieces of this migration (F2.1 unique index, F2.3 freeze
--    trigger, F2.4 / F2.2 RLS comments, F2.8 models firewall) are correct
--    and remain in force.
--
-- Scope (audit, not feature work; minimal canonical fixes):
--   F2.1  Invoice UNIQUE — prevent duplicate active agency_to_client
--         invoices per source option_request (defense-in-depth besides the
--         per-row idempotency check inside fn_create_agency_client_invoice_draft).
--   F2.3  Snapshot immutability — freeze billing snapshots, invoice_number,
--         invoice_type, source_option_request_id and organization_id once
--         the invoice leaves draft (or once the snapshot is set).
--   F2.4  Recipient RLS clarification — explicit COMMENT documenting why
--         the recipient SELECT remains owner-only and post-send only.
--   F2.7  Trigger log — enhance the auto-draft trigger warning with full
--         context (orgs, fee, currency) so failures are auditable from
--         postgres logs (activity_logs requires user_id NOT NULL → unsuitable
--         for a system-context trigger).
--   F2.8  Models firewall — defense-in-depth: can_user_read_invoice now
--         explicitly returns false for users linked to a model row, in
--         addition to the structural fact that models lack org membership.
--
-- Out of scope (intentionally unchanged):
--   F2.2  Void policy — current policies already restrict UPDATE on void
--         transitions to drafts only (owner) or admins. Voiding sent
--         invoices is admin-only and remains a future RPC if a product
--         flow needs it; no new RPC is added here to keep the change
--         minimal. A clarifying COMMENT is attached.
--   F2.5  Split-brain handling — TypeScript / Edge Function concern.
--   F2.6  Stripe tax sync — TypeScript / Edge Function concern.
--
-- Idempotent: re-running this migration is safe.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- F2.1 — Partial UNIQUE index on (organization_id, source_option_request_id, invoice_type)
--
-- Background:
--   fn_create_agency_client_invoice_draft does a SELECT count(*) idempotency
--   check, which is per-row safe under PG row-level locking on the
--   triggering UPDATE. However any non-trigger write path (manual insert,
--   future RPC, race between two distinct option_requests pointing at the
--   same source) could still create duplicates.
--
-- Rule: there must be at most ONE non-void agency_to_client invoice per
--       (issuer_org, source_option_request).
-- ---------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_agency_client_source_option_request
  ON public.invoices (organization_id, source_option_request_id, invoice_type)
  WHERE source_option_request_id IS NOT NULL
    AND invoice_type = 'agency_to_client'::public.invoice_type
    AND status <> 'void'::public.invoice_status;

COMMENT ON INDEX public.uq_invoices_agency_client_source_option_request IS
  'F2.1 (audit 20261104): exactly one non-void agency_to_client invoice per (issuer_org, source_option_request). Voided invoices are excluded so re-issuance after void is possible.';


-- ---------------------------------------------------------------------
-- F2.3 — Snapshot / numbering / type immutability trigger
--
-- Locks the following columns once they are populated AND once the row
-- has left draft (i.e. once an invoice has been "sent" or beyond):
--   - invoice_number
--   - invoice_type
--   - organization_id
--   - source_option_request_id
--   - billing_profile_snapshot
--   - recipient_billing_snapshot
--
-- Rationale:
--   send-invoice-via-stripe reserves the invoice_number and freezes the
--   issuer/recipient snapshots when transitioning draft → pending_send →
--   sent. Tax-law and audit semantics require these to be immutable
--   afterwards. Status itself can still progress (sent → paid → overdue
--   → void → uncollectible) via Stripe webhook + admin paths.
--
-- The trigger uses IS DISTINCT FROM so SET-to-same is a no-op.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_invoices_freeze_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_post_draft boolean := (OLD.status <> 'draft'::public.invoice_status);
BEGIN
  -- Identity columns: never mutable, regardless of status.
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'invoice.organization_id is immutable (invoice %)', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.invoice_type IS DISTINCT FROM OLD.invoice_type THEN
    RAISE EXCEPTION 'invoice.invoice_type is immutable (invoice %)', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.source_option_request_id IS DISTINCT FROM OLD.source_option_request_id THEN
    RAISE EXCEPTION 'invoice.source_option_request_id is immutable (invoice %)', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  -- invoice_number: once assigned (NOT NULL) it cannot change.
  IF OLD.invoice_number IS NOT NULL
     AND NEW.invoice_number IS DISTINCT FROM OLD.invoice_number THEN
    RAISE EXCEPTION 'invoice.invoice_number is immutable once assigned (invoice %)', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  -- Billing snapshots: once populated and once status has left draft,
  -- they are frozen. Allow first-time population while still in draft
  -- (so send-invoice-via-stripe can write the snapshots before flipping
  -- the status).
  IF v_post_draft THEN
    IF OLD.billing_profile_snapshot IS NOT NULL
       AND NEW.billing_profile_snapshot IS DISTINCT FROM OLD.billing_profile_snapshot THEN
      RAISE EXCEPTION 'invoice.billing_profile_snapshot is immutable after draft (invoice %)', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;

    IF OLD.recipient_billing_snapshot IS NOT NULL
       AND NEW.recipient_billing_snapshot IS DISTINCT FROM OLD.recipient_billing_snapshot THEN
      RAISE EXCEPTION 'invoice.recipient_billing_snapshot is immutable after draft (invoice %)', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_invoices_freeze_snapshot() IS
  'F2.3 (audit 20261104): freezes identity columns always and billing snapshots / invoice_number once status has left draft.';

DROP TRIGGER IF EXISTS trg_invoices_freeze_snapshot ON public.invoices;
CREATE TRIGGER trg_invoices_freeze_snapshot
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_invoices_freeze_snapshot();


-- ---------------------------------------------------------------------
-- F2.4 — Recipient RLS clarification
--
-- The recipient SELECT path is intentionally:
--   (a) restricted to organizations.owner_id (not generic membership), and
--   (b) restricted to post-send statuses (sent, paid, overdue, void,
--       uncollectible).
--
-- This is a conservative product choice: only the recipient *Owner* gets
-- billing visibility for their inbound invoices, mirroring billing/checkout
-- being Owner-only on the issuer side. Broadening to members is a product
-- decision that requires explicit review (paywall, GDPR, audit log scope).
-- ---------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'invoices'
      AND policyname = 'invoices_recipient_owner_select'
  ) THEN
    EXECUTE $cmt$
      COMMENT ON POLICY invoices_recipient_owner_select ON public.invoices IS
        'F2.4 (audit 20261104): recipient organization Owner only, and only for post-send statuses. Mirrors Owner-only billing model. Broadening requires explicit product/security review.';
    $cmt$;
  END IF;
END $$;

-- F2.2 clarification (no behaviour change): document the existing void semantics.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'invoices'
      AND policyname = 'invoices_owner_update_draft'
  ) THEN
    EXECUTE $cmt$
      COMMENT ON POLICY invoices_owner_update_draft ON public.invoices IS
        'F2.2 (audit 20261104): owners can only update invoices that are currently in draft. Allowed target statuses are draft (in-place edit), pending_send (handover to Edge Function), and void (cancel a draft). Voiding a SENT invoice is admin-only and intentionally has no owner UI path; future credit-note flows must add a dedicated SECURITY DEFINER RPC, not relax this policy.';
    $cmt$;
  END IF;
END $$;


-- ---------------------------------------------------------------------
-- F2.7 — Enhanced trigger log for fn_create_agency_client_invoice_draft
--
-- Replaces the existing function to emit a richer RAISE WARNING on
-- failure (organization_id, recipient, fee, currency) while preserving
-- the public signature, the AFTER UPDATE trigger registration, and the
-- per-row idempotency check.
--
-- activity_logs is intentionally NOT used here because activity_logs.user_id
-- is NOT NULL and trigger context has no authenticated user.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_create_agency_client_invoice_draft()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_agency_org_id   uuid;
  v_client_org_id   uuid;
  v_fee             numeric;
  v_currency        text;
  v_existing_count  int;
  v_invoice_id      uuid;
BEGIN
  -- Only act on the transition INTO job_confirmed.
  IF TG_OP <> 'UPDATE' THEN RETURN NEW; END IF;
  IF NEW.final_status IS DISTINCT FROM 'job_confirmed' THEN RETURN NEW; END IF;
  IF OLD.final_status = 'job_confirmed' THEN RETURN NEW; END IF;

  -- Resolve issuer (agency) + recipient (client) orgs and fee.
  v_agency_org_id := NEW.agency_organization_id;
  v_client_org_id := NEW.client_organization_id;
  v_fee           := COALESCE(NEW.agency_counter_price, NEW.proposed_price);
  v_currency      := COALESCE(NEW.currency, 'EUR');

  IF v_agency_org_id IS NULL THEN
    RAISE WARNING '[fn_create_agency_client_invoice_draft] skip option_request=% : no agency_organization_id', NEW.id;
    RETURN NEW;
  END IF;

  IF v_fee IS NULL OR v_fee <= 0 THEN
    RAISE WARNING '[fn_create_agency_client_invoice_draft] skip option_request=% : invalid fee=% currency=%', NEW.id, v_fee, v_currency;
    RETURN NEW;
  END IF;

  -- Per-row idempotency (the partial UNIQUE index is the structural guard).
  SELECT count(*)
    INTO v_existing_count
  FROM public.invoices
  WHERE organization_id = v_agency_org_id
    AND source_option_request_id = NEW.id
    AND invoice_type = 'agency_to_client'::public.invoice_type
    AND status <> 'void'::public.invoice_status;

  IF v_existing_count > 0 THEN
    RETURN NEW;
  END IF;

  BEGIN
    INSERT INTO public.invoices (
      organization_id,
      recipient_organization_id,
      invoice_type,
      status,
      source_option_request_id,
      currency,
      subtotal_amount,
      tax_amount,
      total_amount,
      created_by_user_id
    ) VALUES (
      v_agency_org_id,
      v_client_org_id,
      'agency_to_client'::public.invoice_type,
      'draft'::public.invoice_status,
      NEW.id,
      v_currency,
      v_fee,
      0,
      v_fee,
      NULL
    )
    RETURNING id INTO v_invoice_id;

    -- Insert single line for the booking fee.
    INSERT INTO public.invoice_line_items (
      invoice_id, description, quantity, unit_amount, tax_rate, line_total_amount
    ) VALUES (
      v_invoice_id,
      'Booking fee — option request ' || NEW.id::text,
      1,
      v_fee,
      0,
      v_fee
    );
  EXCEPTION
    WHEN unique_violation THEN
      -- Concurrent creation hit the F2.1 unique index. Treat as success.
      RAISE NOTICE '[fn_create_agency_client_invoice_draft] dedup option_request=% agency_org=% (concurrent insert)', NEW.id, v_agency_org_id;
    WHEN OTHERS THEN
      RAISE WARNING '[fn_create_agency_client_invoice_draft] FAILED option_request=% agency_org=% client_org=% fee=% currency=% : % (SQLSTATE %)',
        NEW.id, v_agency_org_id, v_client_org_id, v_fee, v_currency, SQLERRM, SQLSTATE;
  END;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_create_agency_client_invoice_draft() IS
  'F2.7 (audit 20261104): auto-creates one DRAFT agency_to_client invoice on option_requests.final_status → job_confirmed. Idempotent per (issuer_org, source_option_request) via SELECT count(*) plus the F2.1 partial UNIQUE index. Failures emit RAISE WARNING with full context (org ids, fee, currency).';


-- ---------------------------------------------------------------------
-- F2.8 — Models firewall (defense-in-depth)
--
-- Models are structurally barred from invoice access because
--   (a) they have no row in organization_members for any org, and
--   (b) they cannot be organizations.owner_id.
--
-- This adds an explicit early-return so a future linking change (e.g. a
-- model being granted a client/booker side account) cannot accidentally
-- expose invoices to the model identity.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_user_read_invoice(p_invoice_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO 'off'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_inv RECORD;
  v_is_member          boolean := false;
  v_is_recipient_owner boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  -- F2.8: defense-in-depth. Models never read invoices regardless of any
  -- future linking. Admin check still wins above this so an admin who is
  -- also linked to a model row keeps access (admin identity is paramount).
  IF public.is_current_user_admin() THEN
    RETURN true;
  END IF;

  IF public.caller_is_linked_model() THEN
    RETURN false;
  END IF;

  SELECT organization_id, recipient_organization_id, status
    INTO v_inv
  FROM public.invoices
  WHERE id = p_invoice_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Member of issuer org → can read everything (booker/employee transparency)
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = v_inv.organization_id
      AND user_id = v_uid
  ) INTO v_is_member;

  IF v_is_member THEN
    RETURN true;
  END IF;

  -- Owner of recipient org → only post-send statuses
  IF v_inv.recipient_organization_id IS NOT NULL
     AND v_inv.status IN ('sent', 'paid', 'overdue', 'void', 'uncollectible')
  THEN
    SELECT EXISTS (
      SELECT 1 FROM public.organizations
      WHERE id = v_inv.recipient_organization_id
        AND owner_id = v_uid
    ) INTO v_is_recipient_owner;

    IF v_is_recipient_owner THEN
      RETURN true;
    END IF;
  END IF;

  RETURN false;
END;
$function$;

COMMENT ON FUNCTION public.can_user_read_invoice(uuid) IS
  'F2.8 (audit 20261104): admin > linked-model deny > issuer member > recipient owner (post-send). Defense-in-depth: linked-model identity is explicitly denied even though models structurally lack org membership.';

COMMIT;
