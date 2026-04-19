-- ============================================================================
-- Billing System Evolution — Phase X
-- 2026-11-12
--
-- Table: public.agency_client_billing_presets
--
-- Purpose:
--   Per Agency × Client Organization reusable billing preset / template.
--   Used to PREFILL invoice drafts. Presets are convenience defaults only —
--   they NEVER live-link into an immutable invoice. Existing invoice
--   snapshots remain canonical (billing_profile_snapshot immutability).
--
-- Permissions:
--   - Admin                 : full access via is_current_user_admin()
--   - Issuer agency members : SELECT (transparency)
--   - Issuer agency owner   : INSERT / UPDATE / DELETE
--   - Client org            : DENY (agency-private)
--   - Models                : DENY (no organization_members membership)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.agency_client_billing_presets (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  agency_organization_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_organization_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  label                           text,
  is_default                      boolean NOT NULL DEFAULT false,

  -- Recipient billing identity (override of client's own billing profile if needed)
  recipient_billing_name          text,
  recipient_billing_address_1     text,
  recipient_billing_address_2     text,
  recipient_billing_city          text,
  recipient_billing_postal_code   text,
  recipient_billing_state         text,
  recipient_billing_country       text,
  recipient_billing_email         text,
  recipient_vat_id                text,
  recipient_tax_id                text,

  -- Invoice defaults
  default_currency                text NOT NULL DEFAULT 'EUR',
  default_tax_mode                text NOT NULL DEFAULT 'manual'
                                    CHECK (default_tax_mode IN ('manual', 'stripe_tax')),
  default_tax_rate_percent        numeric(5, 2),
  default_reverse_charge          boolean NOT NULL DEFAULT false,
  default_payment_terms_days      integer NOT NULL DEFAULT 30,
  default_notes                   text,
  default_line_item_template      jsonb NOT NULL DEFAULT '[]'::jsonb,

  metadata                        jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_by                      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.agency_client_billing_presets ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.agency_client_billing_presets IS
  'Per Agency × Client Organization reusable billing preset (template). '
  'Used to PREFILL invoice drafts; never live-linked. Owner-managed by issuer agency.';

COMMENT ON COLUMN public.agency_client_billing_presets.default_line_item_template IS
  'JSON array of [{ description, quantity, unit_amount_cents }] used as line item seed.';

-- One default preset per (agency, client) pair (partial unique)
CREATE UNIQUE INDEX IF NOT EXISTS acbp_one_default_per_pair
  ON public.agency_client_billing_presets (agency_organization_id, client_organization_id)
  WHERE is_default = true;

CREATE INDEX IF NOT EXISTS acbp_agency_client_idx
  ON public.agency_client_billing_presets (agency_organization_id, client_organization_id);

CREATE INDEX IF NOT EXISTS acbp_agency_idx
  ON public.agency_client_billing_presets (agency_organization_id);

-- ── RLS ────────────────────────────────────────────────────────────────────

CREATE POLICY "acbp_admin_all"
  ON public.agency_client_billing_presets
  FOR ALL TO authenticated
  USING (public.is_current_user_admin())
  WITH CHECK (public.is_current_user_admin());

CREATE POLICY "acbp_agency_member_select"
  ON public.agency_client_billing_presets
  FOR SELECT TO authenticated
  USING (public.is_org_member(agency_organization_id));

CREATE POLICY "acbp_agency_owner_insert"
  ON public.agency_client_billing_presets
  FOR INSERT TO authenticated
  WITH CHECK (public.is_org_owner(agency_organization_id));

CREATE POLICY "acbp_agency_owner_update"
  ON public.agency_client_billing_presets
  FOR UPDATE TO authenticated
  USING (public.is_org_owner(agency_organization_id))
  WITH CHECK (public.is_org_owner(agency_organization_id));

CREATE POLICY "acbp_agency_owner_delete"
  ON public.agency_client_billing_presets
  FOR DELETE TO authenticated
  USING (public.is_org_owner(agency_organization_id));

-- ── GRANTS ─────────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agency_client_billing_presets TO authenticated;

-- ── updated_at trigger ─────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_acbp_updated_at ON public.agency_client_billing_presets;
CREATE TRIGGER trg_acbp_updated_at
  BEFORE UPDATE ON public.agency_client_billing_presets
  FOR EACH ROW EXECUTE FUNCTION public.fn_invoices_set_updated_at();
