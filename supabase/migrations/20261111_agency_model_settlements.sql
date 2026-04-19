-- ============================================================================
-- Billing System Evolution — Phase 2c
-- 2026-11-11
--
-- Tables:
--   public.agency_model_settlements        — internal Agency↔Model accounting
--   public.agency_model_settlement_items   — line items per settlement
--
-- Purpose:
--   Track per-model payouts / commissions / fees that the agency settles
--   internally with its models. NOT visible to models — strictly an internal
--   bookkeeping ledger for the agency.
--
-- Model Firewall (CRITICAL):
--   These tables are NEVER readable or writable by models.
--   Authorisation is gated through `is_org_member` / `is_org_owner`, both
--   of which check `organization_members` only. Models are never present in
--   `organization_members` (they use `model_agency_territories`) — thus the
--   firewall is structurally enforced (RLS-Risiko 13 / system-invariants
--   "Model org architecture (unveränderlich, Fix H 2026-04-13)").
--
-- Permissions:
--   - Admin           : full access via is_current_user_admin()
--   - Agency members  : SELECT (booker/employee transparency)
--   - Agency owner    : INSERT / UPDATE / DELETE (DELETE only on draft)
--   - Models          : DENY (no organization_members membership)
--   - Other agencies  : DENY (org-scoped)
-- ============================================================================

-- ── TABLE: agency_model_settlements ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.agency_model_settlements (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  model_id                    uuid NOT NULL REFERENCES public.models(id) ON DELETE RESTRICT,
  source_option_request_id    uuid REFERENCES public.option_requests(id) ON DELETE SET NULL,

  settlement_number           text,

  status                      text NOT NULL DEFAULT 'draft'
                                CHECK (status IN ('draft', 'recorded', 'paid', 'void')),

  currency                    text NOT NULL DEFAULT 'EUR',

  -- gross = total client/job amount (model's share before commission)
  -- commission = agency cut (kept by agency)
  -- net = amount actually paid out to model (gross - commission, typically)
  gross_amount_cents          bigint NOT NULL DEFAULT 0,
  commission_amount_cents     bigint NOT NULL DEFAULT 0,
  net_amount_cents            bigint NOT NULL DEFAULT 0,

  notes                       text,
  metadata                    jsonb NOT NULL DEFAULT '{}'::jsonb,

  recorded_at                 timestamptz,
  paid_at                     timestamptz,

  created_by                  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.agency_model_settlements ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.agency_model_settlements IS
  'Internal agency-to-model settlement ledger. NEVER visible to models. '
  'Used by agencies to track payouts/commissions per model. '
  'Strictly separate from public.invoices (models firewall preserved).';

COMMENT ON COLUMN public.agency_model_settlements.gross_amount_cents IS
  'Total amount earned by the model (before commission deduction).';
COMMENT ON COLUMN public.agency_model_settlements.commission_amount_cents IS
  'Agency cut kept by the agency.';
COMMENT ON COLUMN public.agency_model_settlements.net_amount_cents IS
  'Net amount actually paid out to the model.';

CREATE INDEX IF NOT EXISTS idx_ams_org_status_created
  ON public.agency_model_settlements (organization_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ams_model
  ON public.agency_model_settlements (model_id);

CREATE INDEX IF NOT EXISTS idx_ams_source_option_request
  ON public.agency_model_settlements (source_option_request_id)
  WHERE source_option_request_id IS NOT NULL;

-- ── TABLE: agency_model_settlement_items ───────────────────────────────────

CREATE TABLE IF NOT EXISTS public.agency_model_settlement_items (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id               uuid NOT NULL REFERENCES public.agency_model_settlements(id) ON DELETE CASCADE,

  description                 text NOT NULL,
  quantity                    numeric(12, 4) NOT NULL DEFAULT 1,
  unit_amount_cents           bigint NOT NULL DEFAULT 0,
  total_amount_cents          bigint NOT NULL DEFAULT 0,

  position                    integer NOT NULL DEFAULT 0,
  source_booking_event_id     uuid,

  metadata                    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.agency_model_settlement_items ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.agency_model_settlement_items IS
  'Line items per agency_model_settlement. Inherits visibility from parent.';

CREATE INDEX IF NOT EXISTS idx_amsi_settlement_position
  ON public.agency_model_settlement_items (settlement_id, position);

-- ── RLS: agency_model_settlements ──────────────────────────────────────────

-- Admin full access
CREATE POLICY "ams_admin_all"
  ON public.agency_model_settlements
  FOR ALL TO authenticated
  USING (public.is_current_user_admin())
  WITH CHECK (public.is_current_user_admin());

-- Agency members can read (booker/employee transparency)
CREATE POLICY "ams_member_select"
  ON public.agency_model_settlements
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));

-- Owner can INSERT
CREATE POLICY "ams_owner_insert"
  ON public.agency_model_settlements
  FOR INSERT TO authenticated
  WITH CHECK (public.is_org_owner(organization_id));

-- Owner can UPDATE (any status — needed for status transitions)
CREATE POLICY "ams_owner_update"
  ON public.agency_model_settlements
  FOR UPDATE TO authenticated
  USING (public.is_org_owner(organization_id))
  WITH CHECK (public.is_org_owner(organization_id));

-- Owner can DELETE only drafts
CREATE POLICY "ams_owner_delete_draft"
  ON public.agency_model_settlements
  FOR DELETE TO authenticated
  USING (
    public.is_org_owner(organization_id)
    AND status = 'draft'
  );

-- ── RLS: agency_model_settlement_items ─────────────────────────────────────

CREATE POLICY "amsi_admin_all"
  ON public.agency_model_settlement_items
  FOR ALL TO authenticated
  USING (public.is_current_user_admin())
  WITH CHECK (public.is_current_user_admin());

CREATE POLICY "amsi_member_select"
  ON public.agency_model_settlement_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.agency_model_settlements s
      WHERE s.id = agency_model_settlement_items.settlement_id
        AND public.is_org_member(s.organization_id)
    )
  );

CREATE POLICY "amsi_owner_insert"
  ON public.agency_model_settlement_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.agency_model_settlements s
      WHERE s.id = agency_model_settlement_items.settlement_id
        AND public.is_org_owner(s.organization_id)
        AND s.status = 'draft'
    )
  );

CREATE POLICY "amsi_owner_update"
  ON public.agency_model_settlement_items
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.agency_model_settlements s
      WHERE s.id = agency_model_settlement_items.settlement_id
        AND public.is_org_owner(s.organization_id)
        AND s.status = 'draft'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.agency_model_settlements s
      WHERE s.id = agency_model_settlement_items.settlement_id
        AND public.is_org_owner(s.organization_id)
        AND s.status = 'draft'
    )
  );

CREATE POLICY "amsi_owner_delete"
  ON public.agency_model_settlement_items
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.agency_model_settlements s
      WHERE s.id = agency_model_settlement_items.settlement_id
        AND public.is_org_owner(s.organization_id)
        AND s.status = 'draft'
    )
  );

-- ── GRANTS ─────────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agency_model_settlements        TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agency_model_settlement_items   TO authenticated;

-- ── updated_at triggers ────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_ams_updated_at ON public.agency_model_settlements;
CREATE TRIGGER trg_ams_updated_at
  BEFORE UPDATE ON public.agency_model_settlements
  FOR EACH ROW EXECUTE FUNCTION public.fn_invoices_set_updated_at();

DROP TRIGGER IF EXISTS trg_amsi_updated_at ON public.agency_model_settlement_items;
CREATE TRIGGER trg_amsi_updated_at
  BEFORE UPDATE ON public.agency_model_settlement_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_invoices_set_updated_at();
