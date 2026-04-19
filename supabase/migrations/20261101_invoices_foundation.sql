-- ============================================================================
-- B2B Stripe Invoicing Foundation
-- 2026-11-01
--
-- Tables:
--   public.invoices             — issued invoices (B2B + platform commissions)
--   public.invoice_line_items   — line items per invoice
--   public.invoice_sequences    — sequential numbering per (org, type, year)
--   public.invoice_events       — audit log of invoice actions (.cursorrules §17)
--
-- Invoice types:
--   - 'agency_to_client'    : Agency bills a client for a confirmed job
--   - 'platform_to_agency'  : Platform bills an agency (monthly commission)
--   - 'platform_to_client'  : Reserved (currently unused — future flexibility)
--
-- Access (I-PAY-3 + I-PAY-10):
--   - Admin              : full access via is_current_user_admin()
--   - Owner of issuer    : SELECT all + INSERT + UPDATE (drafts only)
--   - Members of issuer  : SELECT (booker/employee read-only for transparency)
--   - Owner of recipient : SELECT only when status IN (sent, paid, overdue, void, uncollectible)
--   - Models             : DENY (I-PAY-10 model billing firewall)
--
-- PSP-agnostic:
--   payment_provider column allows future Adyen support without schema break.
-- ============================================================================

-- ── ENUM types ──────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE public.invoice_type AS ENUM (
    'agency_to_client',
    'platform_to_agency',
    'platform_to_client'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.invoice_status AS ENUM (
    'draft',
    'pending_send',
    'sent',
    'paid',
    'overdue',
    'void',
    'uncollectible'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── TABLE: invoices ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.invoices (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  recipient_organization_id   uuid REFERENCES public.organizations(id) ON DELETE SET NULL,

  invoice_type                public.invoice_type NOT NULL,
  status                      public.invoice_status NOT NULL DEFAULT 'draft',

  invoice_number              text,

  source_option_request_id    uuid REFERENCES public.option_requests(id) ON DELETE SET NULL,
  period_start                date,
  period_end                  date,

  payment_provider            text NOT NULL DEFAULT 'stripe',
  payment_provider_metadata   jsonb NOT NULL DEFAULT '{}'::jsonb,
  stripe_invoice_id           text UNIQUE,
  stripe_hosted_url           text,
  stripe_pdf_url              text,
  stripe_payment_intent_id    text,

  billing_profile_snapshot    jsonb,
  recipient_billing_snapshot  jsonb,

  currency                    text NOT NULL DEFAULT 'EUR',
  subtotal_amount_cents       bigint NOT NULL DEFAULT 0,
  tax_amount_cents            bigint NOT NULL DEFAULT 0,
  total_amount_cents          bigint NOT NULL DEFAULT 0,

  tax_rate_percent            numeric(5, 2),
  tax_mode                    text NOT NULL DEFAULT 'manual',
  reverse_charge_applied      boolean NOT NULL DEFAULT false,

  notes                       text,
  due_date                    date,
  sent_at                     timestamptz,
  paid_at                     timestamptz,

  created_by                  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sent_by                     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT invoices_tax_mode_check CHECK (tax_mode IN ('manual', 'stripe_tax')),
  CONSTRAINT invoices_provider_check CHECK (payment_provider IN ('stripe', 'adyen', 'manual'))
);

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.invoices IS
  'B2B and platform invoices. Owner-only writes (drafts), members read; '
  'recipient-org owners see status >= sent. Models have NO access (I-PAY-10).';

COMMENT ON COLUMN public.invoices.organization_id IS 'Issuer org (who sends the invoice).';
COMMENT ON COLUMN public.invoices.recipient_organization_id IS 'Recipient org (who is billed). NULL for platform-internal sources.';
COMMENT ON COLUMN public.invoices.billing_profile_snapshot IS 'Immutable snapshot of issuer billing profile at send time (auditability).';
COMMENT ON COLUMN public.invoices.recipient_billing_snapshot IS 'Immutable snapshot of recipient billing profile at send time.';
COMMENT ON COLUMN public.invoices.payment_provider IS 'PSP for this invoice. Default stripe; adyen reserved.';

CREATE INDEX IF NOT EXISTS idx_invoices_org_status
  ON public.invoices (organization_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_invoices_recipient_status
  ON public.invoices (recipient_organization_id, status)
  WHERE recipient_organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_source_option_request
  ON public.invoices (source_option_request_id)
  WHERE source_option_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_stripe_invoice_id
  ON public.invoices (stripe_invoice_id)
  WHERE stripe_invoice_id IS NOT NULL;

-- One invoice per (issuer, type, year) sequence number — guarantees uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_org_type_number
  ON public.invoices (organization_id, invoice_type, invoice_number)
  WHERE invoice_number IS NOT NULL;

-- Idempotency for monthly platform commission invoices: exactly one per
-- (issuer org, type, period, currency) so concurrent cron runs don't dupe.
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_platform_commission_period
  ON public.invoices (organization_id, recipient_organization_id, invoice_type, period_start, period_end, currency)
  WHERE invoice_type = 'platform_to_agency'
    AND period_start IS NOT NULL
    AND period_end   IS NOT NULL;

-- ── TABLE: invoice_line_items ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.invoice_line_items (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id                  uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,

  description                 text NOT NULL,
  quantity                    numeric(12, 4) NOT NULL DEFAULT 1,
  unit_amount_cents           bigint NOT NULL DEFAULT 0,
  total_amount_cents          bigint NOT NULL DEFAULT 0,
  currency                    text NOT NULL DEFAULT 'EUR',

  source_option_request_id    uuid REFERENCES public.option_requests(id) ON DELETE SET NULL,
  source_booking_event_id     uuid,

  position                    integer NOT NULL DEFAULT 0,
  metadata                    jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.invoice_line_items ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.invoice_line_items IS
  'Line items per invoice. Inherits visibility from parent invoice via SECDEF helper.';

CREATE INDEX IF NOT EXISTS idx_invoice_line_items_invoice
  ON public.invoice_line_items (invoice_id, position);

CREATE INDEX IF NOT EXISTS idx_invoice_line_items_source_option
  ON public.invoice_line_items (source_option_request_id)
  WHERE source_option_request_id IS NOT NULL;

-- ── TABLE: invoice_sequences ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.invoice_sequences (
  organization_id   uuid    NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  invoice_type      public.invoice_type NOT NULL,
  year              integer NOT NULL,
  current_number    bigint  NOT NULL DEFAULT 0,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, invoice_type, year)
);

ALTER TABLE public.invoice_sequences ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.invoice_sequences IS
  'Sequential invoice numbering per (org, type, year). Read/write only via '
  'SECURITY DEFINER RPC public.next_invoice_number() with row-level lock.';

-- ── TABLE: invoice_events ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.invoice_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id        uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  event_type        text NOT NULL,
  actor_user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_role        text,
  payload           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.invoice_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.invoice_events IS
  'Append-only audit log per invoice (created/edited/sent/paid/voided/viewed). '
  'Writes only via SECURITY DEFINER RPCs and edge functions. Reads inherit '
  'from parent invoice visibility.';

CREATE INDEX IF NOT EXISTS idx_invoice_events_invoice
  ON public.invoice_events (invoice_id, created_at DESC);

-- ── HELPER: can_user_read_invoice(invoice_id) ───────────────────────────────
-- SECURITY DEFINER + row_security=off (system-invariants RLS Pflicht).
-- Centralised authorisation logic. Used by line_items / events RLS so RLS
-- policies don't directly join models / profiles (RLS-Risiko 13).
--
-- Read rules (authenticated user u):
--   u is admin                             → true
--   u is member of issuer org              → true
--   u is owner of recipient org AND status IN (sent, paid, overdue, void, uncollectible) → true
--   else                                   → false
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_user_read_invoice(p_invoice_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_inv RECORD;
  v_is_member  boolean := false;
  v_is_recipient_owner boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  IF public.is_current_user_admin() THEN
    RETURN true;
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
$$;

REVOKE ALL    ON FUNCTION public.can_user_read_invoice(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.can_user_read_invoice(uuid) TO authenticated;

COMMENT ON FUNCTION public.can_user_read_invoice IS
  'Centralised invoice read authorisation. Admin OR member-of-issuer OR '
  'owner-of-recipient (post-send only). Models always denied (no membership).';

-- ── RLS: invoices ───────────────────────────────────────────────────────────

-- Admin: full access
CREATE POLICY "invoices_admin_all"
  ON public.invoices
  FOR ALL
  TO authenticated
  USING (public.is_current_user_admin())
  WITH CHECK (public.is_current_user_admin());

-- Issuer-org members: SELECT all
CREATE POLICY "invoices_member_select"
  ON public.invoices
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(organization_id));

-- Recipient owner: SELECT only post-send
CREATE POLICY "invoices_recipient_owner_select"
  ON public.invoices
  FOR SELECT
  TO authenticated
  USING (
    recipient_organization_id IS NOT NULL
    AND status IN ('sent', 'paid', 'overdue', 'void', 'uncollectible')
    AND public.is_org_owner(recipient_organization_id)
  );

-- Issuer owner: INSERT drafts
CREATE POLICY "invoices_owner_insert"
  ON public.invoices
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_org_owner(organization_id)
    AND status = 'draft'
  );

-- Issuer owner: UPDATE drafts only (no edits after send)
CREATE POLICY "invoices_owner_update_draft"
  ON public.invoices
  FOR UPDATE
  TO authenticated
  USING (
    public.is_org_owner(organization_id)
    AND status = 'draft'
  )
  WITH CHECK (
    public.is_org_owner(organization_id)
    AND status IN ('draft', 'pending_send', 'void')
  );

-- Issuer owner: DELETE drafts only
CREATE POLICY "invoices_owner_delete_draft"
  ON public.invoices
  FOR DELETE
  TO authenticated
  USING (
    public.is_org_owner(organization_id)
    AND status = 'draft'
  );

-- ── RLS: invoice_line_items ─────────────────────────────────────────────────

CREATE POLICY "invoice_lines_admin_all"
  ON public.invoice_line_items
  FOR ALL
  TO authenticated
  USING (public.is_current_user_admin())
  WITH CHECK (public.is_current_user_admin());

CREATE POLICY "invoice_lines_select"
  ON public.invoice_line_items
  FOR SELECT
  TO authenticated
  USING (public.can_user_read_invoice(invoice_id));

-- Owner of issuer: write line items only on draft invoices.
CREATE POLICY "invoice_lines_owner_insert_draft"
  ON public.invoice_line_items
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.invoices i
      WHERE i.id = invoice_line_items.invoice_id
        AND i.status = 'draft'
        AND public.is_org_owner(i.organization_id)
    )
  );

CREATE POLICY "invoice_lines_owner_update_draft"
  ON public.invoice_line_items
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.invoices i
      WHERE i.id = invoice_line_items.invoice_id
        AND i.status = 'draft'
        AND public.is_org_owner(i.organization_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.invoices i
      WHERE i.id = invoice_line_items.invoice_id
        AND i.status = 'draft'
        AND public.is_org_owner(i.organization_id)
    )
  );

CREATE POLICY "invoice_lines_owner_delete_draft"
  ON public.invoice_line_items
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.invoices i
      WHERE i.id = invoice_line_items.invoice_id
        AND i.status = 'draft'
        AND public.is_org_owner(i.organization_id)
    )
  );

-- ── RLS: invoice_sequences ──────────────────────────────────────────────────
-- Direct reads denied; access only via next_invoice_number() RPC.

CREATE POLICY "invoice_sequences_admin_select"
  ON public.invoice_sequences
  FOR SELECT
  TO authenticated
  USING (public.is_current_user_admin());

-- ── RLS: invoice_events ─────────────────────────────────────────────────────
-- Inherits read visibility from parent invoice. Writes only via SECDEF RPC /
-- edge function; no direct INSERT policy for authenticated users.

CREATE POLICY "invoice_events_admin_all"
  ON public.invoice_events
  FOR ALL
  TO authenticated
  USING (public.is_current_user_admin())
  WITH CHECK (public.is_current_user_admin());

CREATE POLICY "invoice_events_select"
  ON public.invoice_events
  FOR SELECT
  TO authenticated
  USING (public.can_user_read_invoice(invoice_id));

-- ── GRANTS ──────────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoices              TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_line_items    TO authenticated;
GRANT SELECT                         ON public.invoice_events        TO authenticated;
GRANT SELECT                         ON public.invoice_sequences     TO authenticated;

-- ── updated_at triggers ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_invoices_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoices_updated_at ON public.invoices;
CREATE TRIGGER trg_invoices_updated_at
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.fn_invoices_set_updated_at();

DROP TRIGGER IF EXISTS trg_invoice_line_items_updated_at ON public.invoice_line_items;
CREATE TRIGGER trg_invoice_line_items_updated_at
  BEFORE UPDATE ON public.invoice_line_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_invoices_set_updated_at();
