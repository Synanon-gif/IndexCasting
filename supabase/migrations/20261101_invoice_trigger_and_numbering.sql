-- ============================================================================
-- B2B Stripe Invoicing — auto-draft trigger + sequential numbering
-- 2026-11-01
--
-- 1. RPC public.next_invoice_number(org, type, year)
--    SECURITY DEFINER + SET row_security TO off + row-level lock to prevent
--    duplicate invoice numbers under concurrent inserts. Returns the formatted
--    invoice number (with prefix from organization_billing_defaults).
--
-- 2. Trigger fn_create_agency_client_invoice_draft on option_requests
--    AFTER UPDATE OF final_status WHEN final_status -> 'job_confirmed'.
--    Creates a DRAFT invoice + line item for the agency to bill the client.
--    Defensive: any failure inside the trigger is caught and logged so the
--    job confirmation never breaks. The agency can manually create the draft
--    later via the InvoicesPanel UI.
--
-- Invariants (system-invariants.mdc):
--   - I-PAY-1  (canonical DB state, not in option_requests)
--   - I-PAY-3  (RLS enforces owner-only writes — trigger uses SECDEF bypass)
--   - I-PAY-9  (no custodial funds — invoice is informational, payment via Stripe)
--   - Trigger NEVER calls Stripe synchronously; that happens in the edge func.
-- ============================================================================

-- ── RPC: next_invoice_number ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.next_invoice_number(
  p_organization_id uuid,
  p_invoice_type    public.invoice_type,
  p_year            integer DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_uid           uuid := auth.uid();
  v_year          integer := COALESCE(p_year, EXTRACT(YEAR FROM now())::integer);
  v_next          bigint;
  v_prefix        text;
  v_default_prefix text;
  v_is_admin      boolean := false;
  v_is_org_member boolean := false;
BEGIN
  -- Auth guard. Trigger context (auth.uid IS NULL) is allowed because the
  -- trigger is SECURITY DEFINER and called from inside an UPDATE on
  -- option_requests which already has its own guards.
  IF v_uid IS NOT NULL THEN
    -- Admin bypass
    BEGIN
      v_is_admin := public.is_current_user_admin();
    EXCEPTION WHEN OTHERS THEN
      v_is_admin := false;
    END;

    IF NOT v_is_admin THEN
      SELECT EXISTS (
        SELECT 1 FROM public.organization_members
        WHERE organization_id = p_organization_id AND user_id = v_uid
      ) INTO v_is_org_member;

      IF NOT v_is_org_member THEN
        RAISE EXCEPTION 'access_denied'
          USING HINT = 'next_invoice_number requires membership in the issuer org';
      END IF;
    END IF;
  END IF;

  -- Atomic upsert + lock + increment. PostgreSQL guarantees the row is
  -- locked (FOR UPDATE) within this statement, so concurrent callers will
  -- block until commit, then receive distinct numbers.
  INSERT INTO public.invoice_sequences (organization_id, invoice_type, year, current_number)
  VALUES (p_organization_id, p_invoice_type, v_year, 1)
  ON CONFLICT (organization_id, invoice_type, year)
    DO UPDATE SET current_number = invoice_sequences.current_number + 1,
                  updated_at     = now()
  RETURNING current_number INTO v_next;

  -- Resolve prefix:
  --   1. organization_billing_defaults.invoice_number_prefix
  --   2. fallback per type
  SELECT invoice_number_prefix INTO v_default_prefix
  FROM public.organization_billing_defaults
  WHERE organization_id = p_organization_id;

  v_prefix := COALESCE(
    NULLIF(v_default_prefix, ''),
    CASE p_invoice_type
      WHEN 'agency_to_client'   THEN 'INV'
      WHEN 'platform_to_agency' THEN 'PLT'
      WHEN 'platform_to_client' THEN 'PLT'
      ELSE 'INV'
    END
  );

  -- Format: PREFIX-YYYY-NNNNNN (zero-padded to 6 digits → 999,999/year/org/type)
  RETURN v_prefix || '-' || v_year::text || '-' || LPAD(v_next::text, 6, '0');
END;
$$;

REVOKE ALL    ON FUNCTION public.next_invoice_number(uuid, public.invoice_type, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.next_invoice_number(uuid, public.invoice_type, integer) TO authenticated;

COMMENT ON FUNCTION public.next_invoice_number IS
  'Reserves the next sequential invoice number for (org, type, year) using a '
  'row-level locked upsert. Tax-law compliant gap-free sequence per issuer. '
  'Caller must be admin OR member of issuer org (or trigger context).';

-- ── TRIGGER: fn_create_agency_client_invoice_draft ──────────────────────────

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
BEGIN
  -- Fire only when transitioning into job_confirmed
  IF NOT (
    (TG_OP = 'UPDATE')
    AND (OLD.final_status IS DISTINCT FROM 'job_confirmed')
    AND (NEW.final_status = 'job_confirmed')
  ) THEN
    RETURN NEW;
  END IF;

  BEGIN
    -- Skip agency-only events: no client to bill (agency-only flow,
    -- .cursor/rules/agency-only-option-casting.mdc invariant 1).
    IF NEW.is_agency_only IS TRUE THEN
      RETURN NEW;
    END IF;

    v_agency_org := NEW.agency_organization_id;
    v_client_org := NEW.client_organization_id;

    -- Need both orgs to issue a B2B invoice
    IF v_agency_org IS NULL OR v_client_org IS NULL THEN
      RAISE WARNING '[fn_create_agency_client_invoice_draft] Skipping invoice draft for option_request %: missing agency_organization_id or client_organization_id', NEW.id;
      RETURN NEW;
    END IF;

    -- Idempotency: don't recreate if a draft already exists for this option_request
    SELECT COUNT(*) INTO v_existing_count
    FROM public.invoices
    WHERE source_option_request_id = NEW.id
      AND organization_id           = v_agency_org
      AND invoice_type              = 'agency_to_client';

    IF v_existing_count > 0 THEN
      RETURN NEW;
    END IF;

    -- Canonical agreed fee: agency_counter_price overrides proposed_price
    v_unit_price_cents := COALESCE(
      ROUND(COALESCE(NEW.agency_counter_price, NEW.proposed_price, 0) * 100)::bigint,
      0
    );

    v_currency := COALESCE(NEW.currency, 'EUR');

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

  EXCEPTION WHEN OTHERS THEN
    -- Defensive: never block job confirmation. The agency can create the
    -- invoice manually from the InvoicesPanel.
    RAISE WARNING '[fn_create_agency_client_invoice_draft] auto-draft failed for option_request % : % (SQLSTATE %)', NEW.id, SQLERRM, SQLSTATE;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_agency_client_invoice_draft ON public.option_requests;
CREATE TRIGGER trg_create_agency_client_invoice_draft
  AFTER UPDATE OF final_status ON public.option_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_create_agency_client_invoice_draft();

COMMENT ON FUNCTION public.fn_create_agency_client_invoice_draft IS
  'After job_confirmed transition: creates a DRAFT B2B invoice (agency→client). '
  'Skips agency-only events. Idempotent per option_request. Defensive: any '
  'failure is logged but does NOT break the job confirmation.';
