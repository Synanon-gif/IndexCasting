-- ============================================================================
-- Manual Billing Foundation — Agency Billing Profiles + Manual Invoices
-- 2026-12-10
--
-- Strictly ADDITIVE feature. Does NOT modify or replace:
--   * public.invoices                       (Stripe-routed B2B invoices)
--   * public.invoice_line_items
--   * public.invoice_sequences / events
--   * public.organization_billing_profiles  (existing canonical billing identity)
--   * public.organization_billing_defaults
--   * public.agency_client_billing_presets
--   * public.agency_model_settlements (+ items)
--
-- New tables (all prefixed `manual_billing_*` for unmistakable separation):
--   * public.manual_billing_agency_profiles  — own legal entities (Poetry Of People Ltd, etc.)
--   * public.manual_billing_counterparties   — reusable client / model billing profiles
--                                              (free-text, no required link to an org or model row)
--   * public.manual_invoices                 — manual invoice header (draft / generated)
--   * public.manual_invoice_line_items       — line items per manual invoice
--
-- RLS posture (I-PAY-3 + I-PAY-10):
--   * Tenant: agency_organization_id (REFERENCES public.organizations)
--   * READ + WRITE: agency org members (owner OR booker) via is_org_member()
--     — Booker parity in day-to-day billing operations (Phase A 2026-11-20).
--   * Models: NO policies (firewall — same posture as agency_model_settlements).
--   * Admin: full access via is_current_user_admin().
--
-- Status & numbering:
--   * Status enum: draft | generated | void  (Phase 1: draft+generated; void reserved.)
--   * Numbering: per-agency-org sequential text in manual_invoices.invoice_number.
--     Uniqueness enforced via partial unique index per (agency_organization_id, invoice_number).
--     Number is user-editable until first generation; validated server-side (next number RPC).
-- ============================================================================

-- ── ENUMS ───────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE public.manual_billing_counterparty_kind AS ENUM (
    'client',
    'model'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.manual_invoice_direction AS ENUM (
    'agency_to_client',
    'agency_to_model',
    'model_to_agency'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.manual_invoice_status AS ENUM (
    'draft',
    'generated',
    'void'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── TABLE: manual_billing_agency_profiles ───────────────────────────────────

CREATE TABLE IF NOT EXISTS public.manual_billing_agency_profiles (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_organization_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  legal_name                  text NOT NULL,
  trading_name                text,

  address_line_1              text,
  address_line_2              text,
  city                        text,
  postal_code                 text,
  state                       text,
  country_code                text,

  company_registration_number text,
  vat_number                  text,
  tax_number                  text,

  phone                       text,
  email                       text,
  website                     text,

  bank_name                   text,
  bank_address                text,
  iban                        text,
  bic                         text,
  account_holder              text,

  default_currency            text NOT NULL DEFAULT 'EUR',
  default_payment_terms_days  integer NOT NULL DEFAULT 30,
  default_vat_treatment       text,
  default_reverse_charge_note text,
  footer_notes                text,

  is_archived                 boolean NOT NULL DEFAULT false,
  is_default                  boolean NOT NULL DEFAULT false,

  created_by                  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT manual_billing_agency_profiles_legal_name_not_blank
    CHECK (length(btrim(legal_name)) > 0),
  CONSTRAINT manual_billing_agency_profiles_currency_3
    CHECK (length(default_currency) = 3),
  CONSTRAINT manual_billing_agency_profiles_terms_nonneg
    CHECK (default_payment_terms_days >= 0)
);

ALTER TABLE public.manual_billing_agency_profiles ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.manual_billing_agency_profiles IS
  'Sender legal entities for manual invoices (e.g. multiple agency brands). '
  'Strictly separate from organization_billing_profiles (which feeds Stripe-routed B2B invoices).';

CREATE INDEX IF NOT EXISTS idx_mb_agency_profiles_org_active
  ON public.manual_billing_agency_profiles (agency_organization_id, is_archived, legal_name);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mb_agency_profiles_org_default
  ON public.manual_billing_agency_profiles (agency_organization_id)
  WHERE is_default = true;

-- ── TABLE: manual_billing_counterparties ────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.manual_billing_counterparties (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_organization_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  kind                        public.manual_billing_counterparty_kind NOT NULL,

  legal_name                  text NOT NULL,
  display_name                text,

  address_line_1              text,
  address_line_2              text,
  city                        text,
  postal_code                 text,
  state                       text,
  country_code                text,

  vat_number                  text,
  tax_number                  text,
  company_registration_number text,

  contact_person              text,
  billing_email               text,
  phone                       text,

  -- Recipient-side conveniences (clients)
  po_number                   text,
  ap_contact                  text,

  -- Bank details: typically only used for `kind='model'` (sender side),
  -- but allowed on either to avoid a second free-text profile table.
  bank_name                   text,
  iban                        text,
  bic                         text,
  account_holder              text,

  default_currency            text NOT NULL DEFAULT 'EUR',
  default_payment_terms_days  integer NOT NULL DEFAULT 30,
  default_vat_treatment       text,
  default_invoice_note        text,

  -- Cost-handling defaults (clients) — purely informational hints
  default_service_charge_pct  numeric(6, 3),
  default_expenses_reimbursed boolean NOT NULL DEFAULT false,
  default_travel_separate     boolean NOT NULL DEFAULT false,
  default_agency_fee_separate boolean NOT NULL DEFAULT false,

  -- Optional weak link to existing system rows. Never enforced as required.
  linked_organization_id      uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  linked_model_id             uuid REFERENCES public.models(id)        ON DELETE SET NULL,

  notes                       text,

  is_archived                 boolean NOT NULL DEFAULT false,

  created_by                  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT manual_billing_counterparties_legal_name_not_blank
    CHECK (length(btrim(legal_name)) > 0),
  CONSTRAINT manual_billing_counterparties_currency_3
    CHECK (length(default_currency) = 3),
  CONSTRAINT manual_billing_counterparties_terms_nonneg
    CHECK (default_payment_terms_days >= 0),
  CONSTRAINT manual_billing_counterparties_service_charge_range
    CHECK (default_service_charge_pct IS NULL OR (default_service_charge_pct >= 0 AND default_service_charge_pct <= 100))
);

ALTER TABLE public.manual_billing_counterparties ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.manual_billing_counterparties IS
  'Reusable client/model billing profiles for manual invoicing. Free-text by design — '
  'the optional linked_organization_id / linked_model_id are convenience anchors only, '
  'never required. Models firewall: NO model-facing policy (I-PAY-10).';

CREATE INDEX IF NOT EXISTS idx_mb_counterparties_org_kind_active
  ON public.manual_billing_counterparties (agency_organization_id, kind, is_archived, legal_name);

CREATE INDEX IF NOT EXISTS idx_mb_counterparties_org_legal_name
  ON public.manual_billing_counterparties (agency_organization_id, legal_name);

-- ── TABLE: manual_invoices ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.manual_invoices (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_organization_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  direction                   public.manual_invoice_direction NOT NULL,
  status                      public.manual_invoice_status NOT NULL DEFAULT 'draft',

  invoice_number              text,

  -- Sender / recipient profile FK references (one of agency or counterparty per side)
  sender_agency_profile_id        uuid REFERENCES public.manual_billing_agency_profiles(id) ON DELETE SET NULL,
  sender_counterparty_id          uuid REFERENCES public.manual_billing_counterparties(id)  ON DELETE SET NULL,
  recipient_agency_profile_id     uuid REFERENCES public.manual_billing_agency_profiles(id) ON DELETE SET NULL,
  recipient_counterparty_id       uuid REFERENCES public.manual_billing_counterparties(id)  ON DELETE SET NULL,

  -- Frozen snapshots once status='generated' (immutable record for audit/print)
  sender_snapshot             jsonb,
  recipient_snapshot          jsonb,

  issue_date                  date,
  supply_date                 date,
  due_date                    date,
  payment_terms_days          integer,

  currency                    text NOT NULL DEFAULT 'EUR',

  po_number                   text,
  buyer_reference             text,
  job_reference               text,
  booking_reference           text,

  -- Totals are derived from line items but cached here for list views & PDF
  subtotal_rates_cents        bigint NOT NULL DEFAULT 0,
  subtotal_expenses_cents     bigint NOT NULL DEFAULT 0,
  service_charge_cents        bigint NOT NULL DEFAULT 0,
  tax_total_cents             bigint NOT NULL DEFAULT 0,
  grand_total_cents           bigint NOT NULL DEFAULT 0,

  service_charge_pct          numeric(6, 3),
  vat_breakdown               jsonb NOT NULL DEFAULT '[]'::jsonb,
  reverse_charge_applied      boolean NOT NULL DEFAULT false,
  tax_note                    text,
  invoice_notes               text,
  payment_instructions        text,
  footer_notes                text,

  generated_at                timestamptz,
  generated_by                uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  created_by                  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT manual_invoices_currency_3
    CHECK (length(currency) = 3),
  CONSTRAINT manual_invoices_payment_terms_nonneg
    CHECK (payment_terms_days IS NULL OR payment_terms_days >= 0)
);

ALTER TABLE public.manual_invoices ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.manual_invoices IS
  'Manual invoices (PDF-oriented, non-Stripe). Strictly separate from public.invoices. '
  'Three directions supported: agency_to_client | agency_to_model | model_to_agency. '
  'Booker parity for day-to-day operational writes; Owner-only for delete/void.';

CREATE INDEX IF NOT EXISTS idx_manual_invoices_org_status_created
  ON public.manual_invoices (agency_organization_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_manual_invoices_org_direction
  ON public.manual_invoices (agency_organization_id, direction, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_manual_invoices_org_number
  ON public.manual_invoices (agency_organization_id, invoice_number)
  WHERE invoice_number IS NOT NULL;

-- ── TABLE: manual_invoice_line_items ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.manual_invoice_line_items (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id                  uuid NOT NULL REFERENCES public.manual_invoices(id) ON DELETE CASCADE,

  position                    integer NOT NULL DEFAULT 0,

  -- Categorisation: free-text category (e.g. day_rate, half_day, fitting, show_fee,
  -- usage, travel, taxi, flight, hotel, per_diem, agency_fee, production_cost,
  -- photography, cancellation_fee, custom). NOT an enum so accountancy stays flexible.
  category                    text,
  is_expense                  boolean NOT NULL DEFAULT false,

  description                 text NOT NULL DEFAULT '',
  notes                       text,

  -- Optional grouping anchors (purely informational — used for PDF grouping)
  model_label                 text,
  job_label                   text,
  performed_on                date,

  quantity                    numeric(12, 4) NOT NULL DEFAULT 1,
  unit                        text,
  unit_amount_cents           bigint NOT NULL DEFAULT 0,
  net_amount_cents            bigint NOT NULL DEFAULT 0,

  -- Tax: explicit per line so reverse charge / zero-rated etc. are visible.
  tax_treatment               text,
  tax_rate_percent            numeric(6, 3),
  tax_amount_cents            bigint NOT NULL DEFAULT 0,
  gross_amount_cents          bigint NOT NULL DEFAULT 0,

  currency                    text NOT NULL DEFAULT 'EUR',

  metadata                    jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT manual_invoice_line_items_currency_3
    CHECK (length(currency) = 3),
  CONSTRAINT manual_invoice_line_items_tax_rate_range
    CHECK (tax_rate_percent IS NULL OR (tax_rate_percent >= 0 AND tax_rate_percent <= 100))
);

ALTER TABLE public.manual_invoice_line_items ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.manual_invoice_line_items IS
  'Line items per manual invoice. Inherits visibility from parent via SECDEF helper.';

CREATE INDEX IF NOT EXISTS idx_manual_invoice_line_items_invoice
  ON public.manual_invoice_line_items (invoice_id, position);

-- ── HELPER: can_user_read_manual_invoice ────────────────────────────────────
-- Centralised authorisation logic used by line-item RLS so child policies don't
-- duplicate the parent join logic (RLS-Risiko 13).

CREATE OR REPLACE FUNCTION public.can_user_read_manual_invoice(p_invoice_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_agency_org uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  IF public.is_current_user_admin() THEN
    RETURN true;
  END IF;

  SELECT agency_organization_id INTO v_agency_org
    FROM public.manual_invoices
   WHERE id = p_invoice_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  RETURN public.is_org_member(v_agency_org);
END;
$$;

REVOKE ALL    ON FUNCTION public.can_user_read_manual_invoice(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.can_user_read_manual_invoice(uuid) TO authenticated;

COMMENT ON FUNCTION public.can_user_read_manual_invoice IS
  'Read authorisation for manual invoice rows. Admin OR member of the owning agency org. '
  'Models always denied (no membership row).';

-- ── RLS: manual_billing_agency_profiles ─────────────────────────────────────

DROP POLICY IF EXISTS "mb_agency_profiles_admin_all" ON public.manual_billing_agency_profiles;
CREATE POLICY "mb_agency_profiles_admin_all"
  ON public.manual_billing_agency_profiles
  FOR ALL
  TO authenticated
  USING (public.is_current_user_admin())
  WITH CHECK (public.is_current_user_admin());

DROP POLICY IF EXISTS "mb_agency_profiles_member_select" ON public.manual_billing_agency_profiles;
CREATE POLICY "mb_agency_profiles_member_select"
  ON public.manual_billing_agency_profiles
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(agency_organization_id));

DROP POLICY IF EXISTS "mb_agency_profiles_member_insert" ON public.manual_billing_agency_profiles;
CREATE POLICY "mb_agency_profiles_member_insert"
  ON public.manual_billing_agency_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_org_member(agency_organization_id));

DROP POLICY IF EXISTS "mb_agency_profiles_member_update" ON public.manual_billing_agency_profiles;
CREATE POLICY "mb_agency_profiles_member_update"
  ON public.manual_billing_agency_profiles
  FOR UPDATE
  TO authenticated
  USING (public.is_org_member(agency_organization_id))
  WITH CHECK (public.is_org_member(agency_organization_id));

-- DELETE: owner-only (sensitive — bank details, default flags)
DROP POLICY IF EXISTS "mb_agency_profiles_owner_delete" ON public.manual_billing_agency_profiles;
CREATE POLICY "mb_agency_profiles_owner_delete"
  ON public.manual_billing_agency_profiles
  FOR DELETE
  TO authenticated
  USING (public.is_org_owner(agency_organization_id));

-- ── RLS: manual_billing_counterparties ──────────────────────────────────────

DROP POLICY IF EXISTS "mb_counterparties_admin_all" ON public.manual_billing_counterparties;
CREATE POLICY "mb_counterparties_admin_all"
  ON public.manual_billing_counterparties
  FOR ALL
  TO authenticated
  USING (public.is_current_user_admin())
  WITH CHECK (public.is_current_user_admin());

DROP POLICY IF EXISTS "mb_counterparties_member_select" ON public.manual_billing_counterparties;
CREATE POLICY "mb_counterparties_member_select"
  ON public.manual_billing_counterparties
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(agency_organization_id));

DROP POLICY IF EXISTS "mb_counterparties_member_insert" ON public.manual_billing_counterparties;
CREATE POLICY "mb_counterparties_member_insert"
  ON public.manual_billing_counterparties
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_org_member(agency_organization_id));

DROP POLICY IF EXISTS "mb_counterparties_member_update" ON public.manual_billing_counterparties;
CREATE POLICY "mb_counterparties_member_update"
  ON public.manual_billing_counterparties
  FOR UPDATE
  TO authenticated
  USING (public.is_org_member(agency_organization_id))
  WITH CHECK (public.is_org_member(agency_organization_id));

DROP POLICY IF EXISTS "mb_counterparties_owner_delete" ON public.manual_billing_counterparties;
CREATE POLICY "mb_counterparties_owner_delete"
  ON public.manual_billing_counterparties
  FOR DELETE
  TO authenticated
  USING (public.is_org_owner(agency_organization_id));

-- ── RLS: manual_invoices ────────────────────────────────────────────────────

DROP POLICY IF EXISTS "manual_invoices_admin_all" ON public.manual_invoices;
CREATE POLICY "manual_invoices_admin_all"
  ON public.manual_invoices
  FOR ALL
  TO authenticated
  USING (public.is_current_user_admin())
  WITH CHECK (public.is_current_user_admin());

DROP POLICY IF EXISTS "manual_invoices_member_select" ON public.manual_invoices;
CREATE POLICY "manual_invoices_member_select"
  ON public.manual_invoices
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(agency_organization_id));

DROP POLICY IF EXISTS "manual_invoices_member_insert" ON public.manual_invoices;
CREATE POLICY "manual_invoices_member_insert"
  ON public.manual_invoices
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_org_member(agency_organization_id)
    AND status = 'draft'
  );

DROP POLICY IF EXISTS "manual_invoices_member_update" ON public.manual_invoices;
CREATE POLICY "manual_invoices_member_update"
  ON public.manual_invoices
  FOR UPDATE
  TO authenticated
  USING (
    public.is_org_member(agency_organization_id)
    AND status IN ('draft', 'generated')
  )
  WITH CHECK (
    public.is_org_member(agency_organization_id)
    AND status IN ('draft', 'generated', 'void')
  );

DROP POLICY IF EXISTS "manual_invoices_owner_delete_draft" ON public.manual_invoices;
CREATE POLICY "manual_invoices_owner_delete_draft"
  ON public.manual_invoices
  FOR DELETE
  TO authenticated
  USING (
    public.is_org_owner(agency_organization_id)
    AND status = 'draft'
  );

-- ── RLS: manual_invoice_line_items ──────────────────────────────────────────

DROP POLICY IF EXISTS "manual_invoice_lines_admin_all" ON public.manual_invoice_line_items;
CREATE POLICY "manual_invoice_lines_admin_all"
  ON public.manual_invoice_line_items
  FOR ALL
  TO authenticated
  USING (public.is_current_user_admin())
  WITH CHECK (public.is_current_user_admin());

DROP POLICY IF EXISTS "manual_invoice_lines_select" ON public.manual_invoice_line_items;
CREATE POLICY "manual_invoice_lines_select"
  ON public.manual_invoice_line_items
  FOR SELECT
  TO authenticated
  USING (public.can_user_read_manual_invoice(invoice_id));

DROP POLICY IF EXISTS "manual_invoice_lines_member_insert" ON public.manual_invoice_line_items;
CREATE POLICY "manual_invoice_lines_member_insert"
  ON public.manual_invoice_line_items
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.manual_invoices i
      WHERE i.id = manual_invoice_line_items.invoice_id
        AND i.status IN ('draft', 'generated')
        AND public.is_org_member(i.agency_organization_id)
    )
  );

DROP POLICY IF EXISTS "manual_invoice_lines_member_update" ON public.manual_invoice_line_items;
CREATE POLICY "manual_invoice_lines_member_update"
  ON public.manual_invoice_line_items
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.manual_invoices i
      WHERE i.id = manual_invoice_line_items.invoice_id
        AND i.status IN ('draft', 'generated')
        AND public.is_org_member(i.agency_organization_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.manual_invoices i
      WHERE i.id = manual_invoice_line_items.invoice_id
        AND i.status IN ('draft', 'generated')
        AND public.is_org_member(i.agency_organization_id)
    )
  );

DROP POLICY IF EXISTS "manual_invoice_lines_member_delete" ON public.manual_invoice_line_items;
CREATE POLICY "manual_invoice_lines_member_delete"
  ON public.manual_invoice_line_items
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.manual_invoices i
      WHERE i.id = manual_invoice_line_items.invoice_id
        AND i.status IN ('draft', 'generated')
        AND public.is_org_member(i.agency_organization_id)
    )
  );

-- ── GRANTS ──────────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON public.manual_billing_agency_profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.manual_billing_counterparties  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.manual_invoices                TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.manual_invoice_line_items      TO authenticated;

-- ── updated_at triggers ─────────────────────────────────────────────────────
-- Reuse existing fn_invoices_set_updated_at (defined in 20261101_invoices_foundation.sql)
-- — same signature, no surprises.

DROP TRIGGER IF EXISTS trg_manual_billing_agency_profiles_updated_at
  ON public.manual_billing_agency_profiles;
CREATE TRIGGER trg_manual_billing_agency_profiles_updated_at
  BEFORE UPDATE ON public.manual_billing_agency_profiles
  FOR EACH ROW EXECUTE FUNCTION public.fn_invoices_set_updated_at();

DROP TRIGGER IF EXISTS trg_manual_billing_counterparties_updated_at
  ON public.manual_billing_counterparties;
CREATE TRIGGER trg_manual_billing_counterparties_updated_at
  BEFORE UPDATE ON public.manual_billing_counterparties
  FOR EACH ROW EXECUTE FUNCTION public.fn_invoices_set_updated_at();

DROP TRIGGER IF EXISTS trg_manual_invoices_updated_at
  ON public.manual_invoices;
CREATE TRIGGER trg_manual_invoices_updated_at
  BEFORE UPDATE ON public.manual_invoices
  FOR EACH ROW EXECUTE FUNCTION public.fn_invoices_set_updated_at();

DROP TRIGGER IF EXISTS trg_manual_invoice_line_items_updated_at
  ON public.manual_invoice_line_items;
CREATE TRIGGER trg_manual_invoice_line_items_updated_at
  BEFORE UPDATE ON public.manual_invoice_line_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_invoices_set_updated_at();

-- ── RPC: next_manual_invoice_number(agency_org, prefix) ─────────────────────
-- Returns the next sequential invoice number for the given agency org and a
-- caller-supplied prefix. Pure read-only suggestion — does NOT consume a slot
-- (the canonical uniqueness is enforced by uq_manual_invoices_org_number on
-- INSERT). Suggested format: "<PREFIX>-<NNNNNN>".

CREATE OR REPLACE FUNCTION public.suggest_next_manual_invoice_number(
  p_agency_organization_id uuid,
  p_prefix                 text DEFAULT 'INV'
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_prefix    text := COALESCE(NULLIF(btrim(p_prefix), ''), 'INV');
  v_max_num   integer := 0;
  v_candidate text;
  v_pattern   text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT public.is_org_member(p_agency_organization_id) THEN
    RAISE EXCEPTION 'access_denied';
  END IF;

  -- Match anything ending in digits after the prefix (e.g. INV-000007, INV-7).
  v_pattern := '^' || regexp_replace(v_prefix, '([\\.\\^\\$\\*\\+\\?\\(\\)\\[\\]\\{\\}\\|\\\\])', '\\\\\\1', 'g') || '-?(\\d+)$';

  SELECT COALESCE(MAX( (regexp_match(invoice_number, v_pattern))[1]::integer ), 0)
    INTO v_max_num
    FROM public.manual_invoices
   WHERE agency_organization_id = p_agency_organization_id
     AND invoice_number IS NOT NULL
     AND invoice_number ~ v_pattern;

  v_candidate := v_prefix || '-' || lpad((v_max_num + 1)::text, 6, '0');
  RETURN v_candidate;
END;
$$;

REVOKE ALL    ON FUNCTION public.suggest_next_manual_invoice_number(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.suggest_next_manual_invoice_number(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.suggest_next_manual_invoice_number IS
  'Suggests next sequential invoice number for a given agency org and prefix '
  '(e.g. INV-000007). Does not reserve / consume — uniqueness is enforced by the '
  'partial unique index uq_manual_invoices_org_number on INSERT.';
