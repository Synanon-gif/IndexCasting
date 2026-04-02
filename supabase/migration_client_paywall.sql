-- =============================================================================
-- Client Paywall Logic
--
-- Updates can_access_platform() to return org_type ('agency' | 'client') in
-- addition to all existing fields. This allows the frontend to render the
-- correct paywall variant and enforce a full-app-lock for blocked client orgs.
--
-- Run after migration_paywall_billing.sql.
--
-- Changes:
--   • REPLACE: can_access_platform() — now returns org_type in every JSONB path
-- =============================================================================

CREATE OR REPLACE FUNCTION public.can_access_platform()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id   UUID;
  v_org_type TEXT;  -- 'agency' | 'client'
  v_override admin_overrides%ROWTYPE;
  v_sub      organization_subscriptions%ROWTYPE;
BEGIN
  -- Resolve org_id AND org_type from auth.uid() in a single join.
  -- Both values come from the same server-side query — neither can be spoofed.
  SELECT om.organization_id, o.type
  INTO   v_org_id, v_org_type
  FROM   organization_members om
  JOIN   organizations o ON o.id = om.organization_id
  WHERE  om.user_id = auth.uid()
  LIMIT  1;

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object(
      'allowed',  false,
      'reason',   'no_org',
      'org_type', NULL
    );
  END IF;

  -- ── 1. Admin override ────────────────────────────────────────────────────
  SELECT * INTO v_override
  FROM   admin_overrides
  WHERE  organization_id = v_org_id;

  IF FOUND AND v_override.bypass_paywall THEN
    RETURN jsonb_build_object(
      'allowed',         true,
      'reason',          'admin_override',
      'plan',            COALESCE(v_override.custom_plan, 'admin'),
      'organization_id', v_org_id,
      'org_type',        v_org_type
    );
  END IF;

  -- ── 2 & 3. Subscription / trial ──────────────────────────────────────────
  SELECT * INTO v_sub
  FROM   organization_subscriptions
  WHERE  organization_id = v_org_id;

  IF FOUND THEN
    -- Trial active
    IF v_sub.trial_ends_at > now() THEN
      RETURN jsonb_build_object(
        'allowed',         true,
        'reason',          'trial_active',
        'trial_ends_at',   v_sub.trial_ends_at,
        'plan',            COALESCE(v_sub.plan, 'trial'),
        'organization_id', v_org_id,
        'org_type',        v_org_type
      );
    END IF;

    -- Subscription active
    IF v_sub.status IN ('active', 'trialing') THEN
      RETURN jsonb_build_object(
        'allowed',         true,
        'reason',          'subscription_active',
        'plan',            COALESCE(v_sub.plan, 'unknown'),
        'organization_id', v_org_id,
        'org_type',        v_org_type
      );
    END IF;
  END IF;

  -- ── 4. No access ─────────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'allowed',         false,
    'reason',          'no_active_subscription',
    'organization_id', v_org_id,
    'org_type',        v_org_type
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.can_access_platform() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_platform() TO authenticated;
