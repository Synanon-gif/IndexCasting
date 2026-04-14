-- ============================================================================
-- Organization billing foundation (B2B prep)
-- 2026-08-19
--
-- Tables:
--   public.organization_billing_profiles  — 1:N billing identities per org (multi-address)
--   public.organization_billing_defaults  — 1:1 defaults for future invoice drafts
--
-- Access:
--   - Org owner: INSERT/UPDATE/DELETE on profiles; INSERT/UPDATE on defaults
--   - Org members (owner + booker/employee): SELECT (invoice prep; models are NOT org members)
--   - Admin: full access via is_current_user_admin()
--
-- Model firewall: models do not appear in organization_members for B2B orgs — they never
-- satisfy is_org_member; no model-facing billing surfaces in this phase.
-- ============================================================================

-- ── TABLE: organization_billing_profiles ────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.organization_billing_profiles (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  label                text,
  billing_name         text,
  billing_address_1    text,
  billing_address_2    text,
  billing_city         text,
  billing_postal_code  text,
  billing_state        text,
  billing_country      text,
  billing_email        text,
  vat_id               text,
  tax_id               text,
  iban                 text,
  bic                  text,
  bank_name            text,
  is_default           boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.organization_billing_profiles ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.organization_billing_profiles IS
  'B2B billing identities (legal name, invoice address, VAT, bank). Owner-managed; '
  'org members may read for future invoice UI. Not exposed to models.';

CREATE UNIQUE INDEX IF NOT EXISTS organization_billing_profiles_one_default_per_org
  ON public.organization_billing_profiles (organization_id)
  WHERE is_default = true;

CREATE INDEX IF NOT EXISTS organization_billing_profiles_org_id_idx
  ON public.organization_billing_profiles (organization_id);

-- ── TABLE: organization_billing_defaults ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.organization_billing_defaults (
  organization_id              uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  default_commission_rate      numeric(5, 2),
  default_tax_rate             numeric(5, 2),
  default_currency             text NOT NULL DEFAULT 'EUR',
  default_payment_terms_days   integer NOT NULL DEFAULT 30,
  invoice_number_prefix        text,
  invoice_notes_template       text,
  reverse_charge_eligible      boolean NOT NULL DEFAULT false,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.organization_billing_defaults ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.organization_billing_defaults IS
  'Default values for future invoice drafts (commission, tax hints, terms). Owner-managed.';

-- ── RLS: organization_billing_profiles ──────────────────────────────────────

CREATE POLICY "obp_admin_all"
  ON public.organization_billing_profiles
  FOR ALL
  TO authenticated
  USING (public.is_current_user_admin())
  WITH CHECK (public.is_current_user_admin());

CREATE POLICY "obp_member_select"
  ON public.organization_billing_profiles
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(organization_id));

CREATE POLICY "obp_owner_insert"
  ON public.organization_billing_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_org_owner(organization_id));

CREATE POLICY "obp_owner_update"
  ON public.organization_billing_profiles
  FOR UPDATE
  TO authenticated
  USING (public.is_org_owner(organization_id))
  WITH CHECK (public.is_org_owner(organization_id));

CREATE POLICY "obp_owner_delete"
  ON public.organization_billing_profiles
  FOR DELETE
  TO authenticated
  USING (public.is_org_owner(organization_id));

-- ── RLS: organization_billing_defaults ────────────────────────────────────────

CREATE POLICY "obd_admin_all"
  ON public.organization_billing_defaults
  FOR ALL
  TO authenticated
  USING (public.is_current_user_admin())
  WITH CHECK (public.is_current_user_admin());

CREATE POLICY "obd_member_select"
  ON public.organization_billing_defaults
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(organization_id));

CREATE POLICY "obd_owner_insert"
  ON public.organization_billing_defaults
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_org_owner(organization_id));

CREATE POLICY "obd_owner_update"
  ON public.organization_billing_defaults
  FOR UPDATE
  TO authenticated
  USING (public.is_org_owner(organization_id))
  WITH CHECK (public.is_org_owner(organization_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_billing_profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.organization_billing_defaults TO authenticated;
