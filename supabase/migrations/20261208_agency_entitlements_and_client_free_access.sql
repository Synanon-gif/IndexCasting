-- =============================================================================
-- Agency plan entitlements (German Stripe product alignment) + client org access
--
-- Product (Apr 2026):
--   agency_basic:      10 GB storage,  2 seats, 10 swipes/day
--   agency_pro:       100 GB storage,  6 seats, 20 swipes/day
--   agency_enterprise: 200 GB storage, 20 seats, 40 swipes/day
--
-- Client organizations: platform access without a paid Stripe subscription
-- (reason subscription_active, plan from row or 'client') — agencies still use
-- trial / Stripe / admin override as before.
-- =============================================================================

-- ── Plan helpers (storage bytes; swipe counts) ───────────────────────────────

CREATE OR REPLACE FUNCTION public.get_plan_swipe_limit(p_plan TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
BEGIN
  RETURN CASE p_plan
    WHEN 'agency_basic'       THEN 10
    WHEN 'agency_pro'         THEN 20
    WHEN 'agency_enterprise' THEN 40
    ELSE 10
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_plan_storage_limit(p_plan TEXT)
RETURNS BIGINT
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
BEGIN
  RETURN CASE p_plan
    WHEN 'agency_basic'       THEN  10737418240   -- 10 GB
    WHEN 'agency_pro'        THEN 107374182400   -- 100 GB
    WHEN 'agency_enterprise' THEN 214748364800   -- 200 GB
    WHEN 'client'            THEN NULL           -- unlimited (sentinel)
    ELSE 10737418240                             -- align with Basic default
  END;
END;
$$;

-- ── Seat cap (agency org members) ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_agency_organization_seat_limit(p_organization_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO off
AS $$
DECLARE
  v_type          text;
  v_override      public.admin_overrides%ROWTYPE;
  v_sub           public.organization_subscriptions%ROWTYPE;
BEGIN
  SELECT o.type INTO v_type
  FROM public.organizations o
  WHERE o.id = p_organization_id;

  IF v_type IS DISTINCT FROM 'agency' THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_override
  FROM public.admin_overrides
  WHERE organization_id = p_organization_id;

  IF FOUND AND v_override.bypass_paywall THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_sub
  FROM public.organization_subscriptions
  WHERE organization_id = p_organization_id;

  IF FOUND AND v_sub.trial_ends_at > now() THEN
    RETURN 2;
  END IF;

  IF FOUND AND v_sub.status IN ('active', 'trialing') THEN
    CASE COALESCE(v_sub.plan, '')
      WHEN 'agency_basic'       THEN RETURN 2;
      WHEN 'agency_pro'         THEN RETURN 6;
      WHEN 'agency_enterprise' THEN RETURN 20;
      ELSE RETURN 2;
    END CASE;
  END IF;

  RETURN 2;
END;
$$;

-- ── can_access_platform: client orgs always allowed after admin override check ──

CREATE OR REPLACE FUNCTION public.can_access_platform()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO off
AS $$
DECLARE
  v_org_id        UUID;
  v_org_type      TEXT;
  v_override      admin_overrides%ROWTYPE;
  v_sub           organization_subscriptions%ROWTYPE;
  v_caller_email  TEXT;
  v_email_hash    TEXT;
  v_trial_blocked BOOLEAN := false;
BEGIN
  SELECT om.organization_id, o.type
  INTO   v_org_id, v_org_type
  FROM   organization_members om
  JOIN   organizations o ON o.id = om.organization_id
  WHERE  om.user_id = auth.uid()
  ORDER  BY om.created_at ASC
  LIMIT  1;

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object(
      'allowed',  false,
      'reason',   'no_org',
      'org_type', NULL
    );
  END IF;

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

  SELECT * INTO v_sub
  FROM   organization_subscriptions
  WHERE  organization_id = v_org_id;

  IF FOUND THEN
    IF v_sub.trial_ends_at > now() THEN
      SELECT email INTO v_caller_email
      FROM   auth.users
      WHERE  id = auth.uid();

      IF v_caller_email IS NOT NULL THEN
        v_email_hash := encode(sha256(lower(v_caller_email)::bytea), 'hex');

        SELECT EXISTS (
          SELECT 1
          FROM   public.used_trial_emails ute
          WHERE  ute.email_hash = v_email_hash
            AND  ute.source_org IS DISTINCT FROM v_org_id
        ) INTO v_trial_blocked;
      END IF;

      IF v_trial_blocked THEN
        RETURN jsonb_build_object(
          'allowed',         false,
          'reason',          'trial_already_used',
          'organization_id', v_org_id,
          'org_type',        v_org_type
        );
      END IF;

      RETURN jsonb_build_object(
        'allowed',         true,
        'reason',          'trial_active',
        'trial_ends_at',   v_sub.trial_ends_at,
        'plan',            COALESCE(v_sub.plan, 'trial'),
        'organization_id', v_org_id,
        'org_type',        v_org_type
      );
    END IF;

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

  IF v_org_type = 'client' THEN
    RETURN jsonb_build_object(
      'allowed',         true,
      'reason',          'subscription_active',
      'plan',            COALESCE((SELECT os.plan FROM organization_subscriptions os WHERE os.organization_id = v_org_id), 'client'),
      'trial_ends_at',   (SELECT os.trial_ends_at FROM organization_subscriptions os WHERE os.organization_id = v_org_id LIMIT 1),
      'organization_id', v_org_id,
      'org_type',        v_org_type
    );
  END IF;

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

COMMENT ON FUNCTION public.can_access_platform IS
  'Paywall gate: admin_override → trial_active (with used_trial_emails) → subscription_active → client orgs free → deny.';

-- ── Sync swipe limits for existing paid/trial agency rows ─────────────────────

UPDATE public.agency_usage_limits ul
SET    daily_swipe_limit = public.get_plan_swipe_limit(s.plan),
       updated_at        = now()
FROM   public.organization_subscriptions s
WHERE  s.organization_id = ul.organization_id
  AND  s.plan IN ('agency_basic', 'agency_pro', 'agency_enterprise');
