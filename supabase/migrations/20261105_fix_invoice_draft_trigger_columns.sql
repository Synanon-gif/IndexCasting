-- =====================================================================
-- Fix: fn_create_agency_client_invoice_draft column drift
-- Date: 2026-11-05
--
-- Background:
--   Migration 20261104_invoices_audit_hardening.sql redefined
--   public.fn_create_agency_client_invoice_draft() with column names that
--   DO NOT EXIST on the live invoices / invoice_line_items tables:
--     - subtotal_amount, tax_amount, total_amount        (live: *_cents)
--     - created_by_user_id                                (live: created_by)
--     - unit_amount, tax_rate, line_total_amount          (live: unit_amount_cents,
--                                                               total_amount_cents)
--   Symptom: every option_requests UPDATE -> final_status='job_confirmed'
--   triggers a 42703 inside the function. The EXCEPTION WHEN OTHERS handler
--   catches it (so job confirmation never breaks — defensive), but NO draft
--   invoice is ever auto-created.
--
--   Additionally lost in 20261104:
--     - is_agency_only skip (agency-only events have no client to bill)
--     - due_date derived from organization_billing_defaults.default_payment_terms_days
--     - request_type-aware description (Casting fee / Booking fee)
--     - audit row in invoice_events ('auto_draft_created')
--
-- This migration:
--   - Restores all original behaviour from 20261101_invoice_trigger_and_numbering.sql
--   - Keeps the F2.7 improvements:
--       * richer RAISE WARNING context (org ids, fee, currency, sqlstate)
--       * explicit handling of unique_violation (F2.1 partial index) as success
--   - Uses ONLY columns that exist on the live schema (verified via
--     information_schema.columns 2026-11-05).
--
-- Idempotent: re-running this migration is safe.
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_create_agency_client_invoice_draft()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_invoice_id        uuid;
  v_agency_org        uuid;
  v_client_org        uuid;
  v_unit_price_cents  bigint;
  v_currency          text;
  v_due_date          date;
  v_payment_terms     integer;
  v_description       text;
  v_existing_count    integer := 0;
  v_fee_numeric       numeric;
BEGIN
  -- Fire only when transitioning into job_confirmed
  IF NOT (
    (TG_OP = 'UPDATE')
    AND (OLD.final_status IS DISTINCT FROM 'job_confirmed')
    AND (NEW.final_status = 'job_confirmed')
  ) THEN
    RETURN NEW;
  END IF;

  -- Resolve issuer (agency) + recipient (client) orgs and fee.
  v_agency_org  := NEW.agency_organization_id;
  v_client_org  := NEW.client_organization_id;
  v_fee_numeric := COALESCE(NEW.agency_counter_price, NEW.proposed_price);
  v_currency    := COALESCE(NEW.currency, 'EUR');

  -- Skip agency-only events: no client to bill (.cursor/rules/agency-only-option-casting.mdc).
  IF NEW.is_agency_only IS TRUE THEN
    RETURN NEW;
  END IF;

  IF v_agency_org IS NULL OR v_client_org IS NULL THEN
    RAISE WARNING '[fn_create_agency_client_invoice_draft] skip option_request=% : missing agency_organization_id=% or client_organization_id=%',
      NEW.id, v_agency_org, v_client_org;
    RETURN NEW;
  END IF;

  IF v_fee_numeric IS NULL OR v_fee_numeric <= 0 THEN
    RAISE WARNING '[fn_create_agency_client_invoice_draft] skip option_request=% agency_org=% client_org=% : invalid fee=% currency=%',
      NEW.id, v_agency_org, v_client_org, v_fee_numeric, v_currency;
    RETURN NEW;
  END IF;

  v_unit_price_cents := ROUND(v_fee_numeric * 100)::bigint;

  -- Per-row idempotency. The F2.1 partial UNIQUE index
  -- (uq_invoices_agency_client_source_option_request) is the structural guard
  -- against concurrent inserts; this SELECT short-circuits the common case.
  SELECT COUNT(*) INTO v_existing_count
  FROM public.invoices
  WHERE source_option_request_id = NEW.id
    AND organization_id           = v_agency_org
    AND invoice_type              = 'agency_to_client'
    AND status                   <> 'void';

  IF v_existing_count > 0 THEN
    RETURN NEW;
  END IF;

  -- Resolve payment terms from agency billing defaults (fallback 30 days)
  SELECT default_payment_terms_days INTO v_payment_terms
  FROM public.organization_billing_defaults
  WHERE organization_id = v_agency_org;

  v_due_date := (now()::date + (COALESCE(v_payment_terms, 30) || ' days')::interval)::date;

  v_description := CASE
    WHEN NEW.request_type = 'casting' THEN
      'Casting fee – ' || COALESCE(NEW.model_name, 'model') ||
      ' on ' || COALESCE(NEW.requested_date::text, '')
    ELSE
      'Booking fee – ' || COALESCE(NEW.model_name, 'model') ||
      ' on ' || COALESCE(NEW.requested_date::text, '')
  END;

  BEGIN
    -- Create the draft invoice
    INSERT INTO public.invoices (
      organization_id,
      recipient_organization_id,
      invoice_type,
      status,
      source_option_request_id,
      currency,
      subtotal_amount_cents,
      tax_amount_cents,
      total_amount_cents,
      due_date,
      created_by
    ) VALUES (
      v_agency_org,
      v_client_org,
      'agency_to_client',
      'draft',
      NEW.id,
      v_currency,
      v_unit_price_cents,
      0,
      v_unit_price_cents,
      v_due_date,
      NEW.created_by
    )
    RETURNING id INTO v_invoice_id;

    -- One line item with the canonical agreed fee
    INSERT INTO public.invoice_line_items (
      invoice_id,
      description,
      quantity,
      unit_amount_cents,
      total_amount_cents,
      currency,
      source_option_request_id,
      position
    ) VALUES (
      v_invoice_id,
      v_description,
      1,
      v_unit_price_cents,
      v_unit_price_cents,
      v_currency,
      NEW.id,
      0
    );

    -- Audit log
    INSERT INTO public.invoice_events (invoice_id, event_type, payload)
    VALUES (
      v_invoice_id,
      'auto_draft_created',
      jsonb_build_object(
        'source', 'trigger',
        'option_request_id', NEW.id,
        'agency_organization_id', v_agency_org,
        'client_organization_id', v_client_org,
        'amount_cents', v_unit_price_cents,
        'currency', v_currency
      )
    );

  EXCEPTION
    WHEN unique_violation THEN
      -- Concurrent creation hit the F2.1 unique index. Treat as success.
      RAISE NOTICE '[fn_create_agency_client_invoice_draft] dedup option_request=% agency_org=% (concurrent insert)',
        NEW.id, v_agency_org;
    WHEN OTHERS THEN
      -- Defensive: never block job confirmation. The agency can create the
      -- invoice manually from the InvoicesPanel.
      RAISE WARNING '[fn_create_agency_client_invoice_draft] FAILED option_request=% agency_org=% client_org=% fee=% currency=% : % (SQLSTATE %)',
        NEW.id, v_agency_org, v_client_org, v_fee_numeric, v_currency, SQLERRM, SQLSTATE;
  END;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_create_agency_client_invoice_draft IS
  'Audit 20261105 fix: restores correct *_cents / created_by columns after the '
  '20261104 column-name regression. After job_confirmed transition: creates a '
  'DRAFT B2B invoice (agency to client). Skips agency-only events. Idempotent '
  'per (issuer_org, source_option_request) via SELECT count(*) plus the F2.1 '
  'partial UNIQUE index (uq_invoices_agency_client_source_option_request). '
  'Defensive: any failure is logged with full context but does NOT break the '
  'job confirmation.';

-- Trigger registration is unchanged from 20261101 (same name, same target).
-- We re-assert it idempotently so a fresh project picks it up.
DROP TRIGGER IF EXISTS trg_create_agency_client_invoice_draft ON public.option_requests;
CREATE TRIGGER trg_create_agency_client_invoice_draft
  AFTER UPDATE OF final_status ON public.option_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_create_agency_client_invoice_draft();

COMMIT;
