-- ============================================================================
-- Stripe customer cache for invoice recipients
-- 2026-11-01
--
-- Why a separate table?
--   - public.organization_subscriptions has a CHECK on `status` limited to
--     ('trialing','active','past_due','canceled') for the paywall.
--   - Invoice recipients may not have any platform subscription at all,
--     but we still need to map organization_id → Stripe customer for
--     idempotent invoice sending.
--   - Keeping this lookup separate avoids polluting the paywall row and
--     respects I-PAY-1 (Stripe = authority; this table is just a cache).
--
-- Access:
--   - Service-role only writes (Edge Functions). No RLS exposure to clients.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.organization_stripe_customers (
  organization_id    uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  stripe_customer_id text NOT NULL UNIQUE,
  purpose            text NOT NULL DEFAULT 'invoice_recipient',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.organization_stripe_customers ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.organization_stripe_customers IS
  'Cache of Stripe customer IDs for organizations that receive invoices. '
  'Separate from organization_subscriptions to avoid conflicting with the paywall CHECK '
  'on status. Service-role writes only; no client-side RLS exposure.';

-- Admin-only read; clients have no business reading this directly.
CREATE POLICY "osc_admin_all"
  ON public.organization_stripe_customers
  FOR ALL
  TO authenticated
  USING (public.is_current_user_admin())
  WITH CHECK (public.is_current_user_admin());

-- updated_at trigger (reuse existing function)
DROP TRIGGER IF EXISTS trg_org_stripe_customers_updated_at ON public.organization_stripe_customers;
CREATE TRIGGER trg_org_stripe_customers_updated_at
  BEFORE UPDATE ON public.organization_stripe_customers
  FOR EACH ROW EXECUTE FUNCTION public.fn_invoices_set_updated_at();
