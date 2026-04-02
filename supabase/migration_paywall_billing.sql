-- =============================================================================
-- Paywall & Billing System
--
-- Adds Stripe-based subscription tracking, 30-day free trial, admin override,
-- and plan-based feature limits (swipes + storage) to every organization.
--
-- Run after migration_admin_storage_override.sql (Phase 29b).
--
-- New tables:
--   • organization_subscriptions  — Stripe data + trial per org
--   • admin_overrides             — bypass_paywall + custom_plan per org
--   • organization_daily_usage    — per-date swipe history (analytics)
--
-- New RPCs (SECURITY DEFINER):
--   • can_access_platform()                      — core access gate
--   • admin_set_bypass_paywall(org,bypass,plan)  — admin override
--   • admin_get_org_subscription(org)            — admin read subscription
--   • admin_set_org_plan(org,plan)               — admin manual plan change
--
-- Updated RPCs:
--   • increment_my_agency_swipe_count            — access + plan-limit aware
--   • increment_agency_storage_usage             — access + plan-limit aware
--
-- Backfill:
--   • Existing orgs get a subscription row (trial already expired → canceled)
-- =============================================================================

-- ─── 1. Tables ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.organization_subscriptions (
  organization_id        UUID        PRIMARY KEY
                                     REFERENCES public.organizations(id) ON DELETE CASCADE,
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  plan                   TEXT        CHECK (plan IN (
                                       'agency_basic', 'agency_pro',
                                       'agency_enterprise', 'client'
                                     )),
  status                 TEXT        NOT NULL DEFAULT 'trialing'
                                     CHECK (status IN (
                                       'trialing', 'active', 'past_due', 'canceled'
                                     )),
  current_period_end     TIMESTAMPTZ,
  trial_ends_at          TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.admin_overrides (
  organization_id UUID        PRIMARY KEY
                              REFERENCES public.organizations(id) ON DELETE CASCADE,
  bypass_paywall  BOOLEAN     NOT NULL DEFAULT false,
  custom_plan     TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.organization_daily_usage (
  organization_id UUID    NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  date            DATE    NOT NULL DEFAULT CURRENT_DATE,
  swipes_used     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, date)
);

-- ─── 2. RLS — organization_subscriptions ──────────────────────────────────────

ALTER TABLE public.organization_subscriptions ENABLE ROW LEVEL SECURITY;

-- Org members can read their own subscription.
DROP POLICY IF EXISTS "org_members_select_own_subscription" ON public.organization_subscriptions;
CREATE POLICY "org_members_select_own_subscription"
  ON public.organization_subscriptions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = organization_subscriptions.organization_id
        AND om.user_id = auth.uid()
    )
  );

-- Admins have full access; normal users never write directly (only via RPCs / webhook).
DROP POLICY IF EXISTS "admin_full_access_subscriptions" ON public.organization_subscriptions;
CREATE POLICY "admin_full_access_subscriptions"
  ON public.organization_subscriptions
  FOR ALL
  TO authenticated
  USING     (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE))
  WITH CHECK(EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE));

-- ─── 3. RLS — admin_overrides ─────────────────────────────────────────────────

ALTER TABLE public.admin_overrides ENABLE ROW LEVEL SECURITY;

-- Org members can read their own override (so the frontend knows if access is via override).
DROP POLICY IF EXISTS "org_members_select_own_override" ON public.admin_overrides;
CREATE POLICY "org_members_select_own_override"
  ON public.admin_overrides
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = admin_overrides.organization_id
        AND om.user_id = auth.uid()
    )
  );

-- Only admins can write (all writes go through SECURITY DEFINER RPCs anyway).
DROP POLICY IF EXISTS "admin_full_access_overrides" ON public.admin_overrides;
CREATE POLICY "admin_full_access_overrides"
  ON public.admin_overrides
  FOR ALL
  TO authenticated
  USING     (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE))
  WITH CHECK(EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE));

-- ─── 4. RLS — organization_daily_usage ────────────────────────────────────────

ALTER TABLE public.organization_daily_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_members_select_own_daily_usage" ON public.organization_daily_usage;
CREATE POLICY "org_members_select_own_daily_usage"
  ON public.organization_daily_usage
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = organization_daily_usage.organization_id
        AND om.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "admin_full_access_daily_usage" ON public.organization_daily_usage;
CREATE POLICY "admin_full_access_daily_usage"
  ON public.organization_daily_usage
  FOR ALL
  TO authenticated
  USING     (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE))
  WITH CHECK(EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE));

-- ─── 5. Helper: resolve plan-based swipe limit ────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_plan_swipe_limit(p_plan TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN CASE p_plan
    WHEN 'agency_basic'      THEN 10
    WHEN 'agency_pro'        THEN 50
    WHEN 'agency_enterprise' THEN 150
    ELSE 10  -- safe default
  END;
END;
$$;

-- ─── 6. Helper: resolve plan-based storage limit (bytes) ─────────────────────

CREATE OR REPLACE FUNCTION public.get_plan_storage_limit(p_plan TEXT)
RETURNS BIGINT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN CASE p_plan
    WHEN 'agency_basic'      THEN  5368709120   -- 5 GB
    WHEN 'agency_pro'        THEN 53687091200   -- 50 GB
    WHEN 'agency_enterprise' THEN 536870912000  -- 500 GB
    WHEN 'client'            THEN NULL           -- unlimited (NULL sentinel)
    ELSE                          5368709120    -- safe default: 5 GB
  END;
END;
$$;

-- ─── 7. Core RPC: can_access_platform() ──────────────────────────────────────
--
-- THE access gate. All enforcement passes through here.
-- organization_id is ALWAYS resolved from auth.uid() — frontend cannot inject it.
--
-- Logic (exact, in order):
--   1. admin_override (bypass_paywall = true) → ALLOW
--   2. trial_active   (trial_ends_at > now()) → ALLOW
--   3. subscription   (status IN active, trialing) → ALLOW
--   4. else → DENY

CREATE OR REPLACE FUNCTION public.can_access_platform()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id   UUID;
  v_override admin_overrides%ROWTYPE;
  v_sub      organization_subscriptions%ROWTYPE;
BEGIN
  -- Resolve the caller's organization from their JWT — cannot be spoofed.
  SELECT om.organization_id INTO v_org_id
  FROM   organization_members om
  WHERE  om.user_id = auth.uid()
  LIMIT  1;

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'no_org');
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
      'organization_id', v_org_id
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
        'organization_id', v_org_id
      );
    END IF;

    -- Subscription active
    IF v_sub.status IN ('active', 'trialing') THEN
      RETURN jsonb_build_object(
        'allowed',         true,
        'reason',          'subscription_active',
        'plan',            COALESCE(v_sub.plan, 'unknown'),
        'organization_id', v_org_id
      );
    END IF;
  END IF;

  -- ── 4. No access ─────────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'allowed',         false,
    'reason',          'no_active_subscription',
    'organization_id', v_org_id
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.can_access_platform() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_platform() TO authenticated;

-- ─── 8. Admin RPC: admin_set_bypass_paywall() ────────────────────────────────
--
-- THE only way to set bypass_paywall. is_admin check is server-side inside the
-- function body — no frontend toggle can ever reach this with elevated access.

CREATE OR REPLACE FUNCTION public.admin_set_bypass_paywall(
  p_org_id     UUID,
  p_bypass     BOOLEAN,
  p_custom_plan TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Hard server-side guard — identical pattern to all existing admin RPCs.
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'admin_set_bypass_paywall: unauthorized';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = p_org_id) THEN
    RAISE EXCEPTION 'admin_set_bypass_paywall: organization not found';
  END IF;

  INSERT INTO admin_overrides (organization_id, bypass_paywall, custom_plan, updated_at)
  VALUES (p_org_id, p_bypass, p_custom_plan, now())
  ON CONFLICT (organization_id) DO UPDATE
    SET bypass_paywall = p_bypass,
        custom_plan    = p_custom_plan,
        updated_at     = now();
END;
$$;

REVOKE ALL    ON FUNCTION public.admin_set_bypass_paywall(UUID, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_bypass_paywall(UUID, BOOLEAN, TEXT) TO authenticated;

-- ─── 9. Admin RPC: admin_get_org_subscription() ──────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_get_org_subscription(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub      organization_subscriptions%ROWTYPE;
  v_override admin_overrides%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'admin_get_org_subscription: unauthorized';
  END IF;

  SELECT * INTO v_sub      FROM organization_subscriptions WHERE organization_id = p_org_id;
  SELECT * INTO v_override FROM admin_overrides             WHERE organization_id = p_org_id;

  RETURN jsonb_build_object(
    'subscription',  CASE WHEN v_sub.organization_id IS NOT NULL THEN to_jsonb(v_sub) ELSE NULL END,
    'admin_override',CASE WHEN v_override.organization_id IS NOT NULL THEN to_jsonb(v_override) ELSE NULL END
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.admin_get_org_subscription(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_org_subscription(UUID) TO authenticated;

-- ─── 10. Admin RPC: admin_set_org_plan() ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_set_org_plan(
  p_org_id UUID,
  p_plan   TEXT,
  p_status TEXT DEFAULT 'active'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'admin_set_org_plan: unauthorized';
  END IF;

  IF p_plan NOT IN ('agency_basic', 'agency_pro', 'agency_enterprise', 'client') THEN
    RAISE EXCEPTION 'admin_set_org_plan: invalid plan %', p_plan;
  END IF;

  IF p_status NOT IN ('trialing', 'active', 'past_due', 'canceled') THEN
    RAISE EXCEPTION 'admin_set_org_plan: invalid status %', p_status;
  END IF;

  INSERT INTO organization_subscriptions (organization_id, plan, status, trial_ends_at)
  VALUES (p_org_id, p_plan, p_status, now())
  ON CONFLICT (organization_id) DO UPDATE
    SET plan   = p_plan,
        status = p_status;

  -- Sync daily swipe limit in agency_usage_limits so the new plan takes effect immediately.
  IF p_plan IN ('agency_basic', 'agency_pro', 'agency_enterprise') THEN
    INSERT INTO agency_usage_limits (organization_id, daily_swipe_limit, swipes_used_today, last_reset_date)
    VALUES (p_org_id, public.get_plan_swipe_limit(p_plan), 0, CURRENT_DATE)
    ON CONFLICT (organization_id) DO UPDATE
      SET daily_swipe_limit = public.get_plan_swipe_limit(p_plan),
          updated_at        = now();
  END IF;
END;
$$;

REVOKE ALL    ON FUNCTION public.admin_set_org_plan(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_org_plan(UUID, TEXT, TEXT) TO authenticated;

-- ─── 11. Updated RPC: increment_my_agency_swipe_count (plan-aware) ───────────
--
-- Checks can_access_platform() FIRST.
-- Then uses the plan-based swipe limit (synced in agency_usage_limits).
-- Records each swipe in organization_daily_usage for analytics.

CREATE OR REPLACE FUNCTION public.increment_my_agency_swipe_count()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id     UUID;
  v_row        agency_usage_limits%ROWTYPE;
  v_today      DATE    := CURRENT_DATE;
  v_access     JSONB;
  v_plan       TEXT;
  v_plan_limit INTEGER;
BEGIN
  -- ── Platform access check (must pass BEFORE any action) ──────────────────
  v_access := public.can_access_platform();
  IF NOT (v_access->>'allowed')::BOOLEAN THEN
    RETURN json_build_object(
      'allowed', false,
      'swipes_used', 0,
      'limit', 0,
      'error', 'platform_access_denied',
      'reason', v_access->>'reason'
    );
  END IF;

  -- Resolve org
  SELECT om.organization_id INTO v_org_id
  FROM   organization_members om
  JOIN   organizations o ON o.id = om.organization_id
  WHERE  om.user_id = auth.uid()
    AND  o.type     = 'agency'
  LIMIT  1;

  IF v_org_id IS NULL THEN
    RETURN json_build_object('allowed', false, 'error', 'No agency organization found for current user');
  END IF;

  -- Determine plan-based limit (falls back to row's stored daily_swipe_limit for backward compat)
  SELECT plan INTO v_plan
  FROM   organization_subscriptions
  WHERE  organization_id = v_org_id;

  v_plan_limit := COALESCE(
    public.get_plan_swipe_limit(v_plan),
    (SELECT daily_swipe_limit FROM agency_usage_limits WHERE organization_id = v_org_id),
    10
  );

  -- Lock the usage row to prevent concurrent increments
  SELECT * INTO v_row
  FROM   agency_usage_limits
  WHERE  organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO agency_usage_limits
      (organization_id, daily_swipe_limit, swipes_used_today, last_reset_date)
    VALUES (v_org_id, v_plan_limit, 0, v_today)
    ON CONFLICT (organization_id) DO NOTHING;

    SELECT * INTO v_row
    FROM   agency_usage_limits
    WHERE  organization_id = v_org_id
    FOR UPDATE;
  END IF;

  -- Daily reset
  IF v_row.last_reset_date IS DISTINCT FROM v_today THEN
    UPDATE agency_usage_limits
    SET    swipes_used_today = 0,
           last_reset_date   = v_today,
           daily_swipe_limit = v_plan_limit,
           updated_at        = now()
    WHERE  organization_id = v_org_id;
    v_row.swipes_used_today := 0;
    v_row.last_reset_date   := v_today;
    v_row.daily_swipe_limit := v_plan_limit;
  ELSE
    -- Ensure limit column stays in sync with plan
    IF v_row.daily_swipe_limit IS DISTINCT FROM v_plan_limit THEN
      UPDATE agency_usage_limits
      SET    daily_swipe_limit = v_plan_limit,
             updated_at        = now()
      WHERE  organization_id = v_org_id;
      v_row.daily_swipe_limit := v_plan_limit;
    END IF;
  END IF;

  -- Enforce limit
  IF v_row.swipes_used_today >= v_plan_limit THEN
    RETURN json_build_object(
      'allowed',     false,
      'swipes_used', v_row.swipes_used_today,
      'limit',       v_plan_limit
    );
  END IF;

  -- Increment
  UPDATE agency_usage_limits
  SET    swipes_used_today = swipes_used_today + 1,
         updated_at        = now()
  WHERE  organization_id = v_org_id;

  -- Record in daily analytics table
  INSERT INTO organization_daily_usage (organization_id, date, swipes_used)
  VALUES (v_org_id, v_today, 1)
  ON CONFLICT (organization_id, date) DO UPDATE
    SET swipes_used = organization_daily_usage.swipes_used + 1;

  RETURN json_build_object(
    'allowed',     true,
    'swipes_used', v_row.swipes_used_today + 1,
    'limit',       v_plan_limit
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.increment_my_agency_swipe_count() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_my_agency_swipe_count() TO authenticated;

-- ─── 12. Updated RPC: increment_agency_storage_usage (plan-aware) ────────────
--
-- Checks can_access_platform() FIRST.
-- Plan-based limits override existing storage_limit_bytes when no admin override is set.

CREATE OR REPLACE FUNCTION public.increment_agency_storage_usage(p_bytes BIGINT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id         UUID;
  v_row            organization_storage_usage%ROWTYPE;
  v_default_limit  BIGINT := 5368709120; -- 5 GB
  v_effective      BIGINT;
  v_access         JSONB;
  v_plan           TEXT;
  v_plan_limit     BIGINT;
BEGIN
  IF p_bytes <= 0 THEN
    RETURN json_build_object('allowed', false, 'error', 'File size must be greater than 0');
  END IF;

  -- ── Platform access check ─────────────────────────────────────────────────
  v_access := public.can_access_platform();
  IF NOT (v_access->>'allowed')::BOOLEAN THEN
    RETURN json_build_object(
      'allowed', false,
      'error',   'platform_access_denied',
      'reason',  v_access->>'reason'
    );
  END IF;

  SELECT om.organization_id INTO v_org_id
  FROM   organization_members om
  JOIN   organizations o ON o.id = om.organization_id
  WHERE  om.user_id = auth.uid()
    AND  o.type     = 'agency'
  LIMIT  1;

  IF v_org_id IS NULL THEN
    -- Clients/models are not storage-limited.
    RETURN json_build_object('allowed', true, 'used_bytes', 0, 'limit_bytes', v_default_limit, 'is_unlimited', false);
  END IF;

  -- Resolve plan-based limit (admin custom/unlimited takes precedence)
  SELECT plan INTO v_plan
  FROM   organization_subscriptions
  WHERE  organization_id = v_org_id;

  v_plan_limit := public.get_plan_storage_limit(v_plan);
  -- NULL from get_plan_storage_limit means 'client' plan → unlimited

  -- Lock row
  SELECT * INTO v_row
  FROM   organization_storage_usage
  WHERE  organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO organization_storage_usage (organization_id, used_bytes)
    VALUES (v_org_id, 0)
    ON CONFLICT (organization_id) DO NOTHING;

    SELECT * INTO v_row
    FROM   organization_storage_usage
    WHERE  organization_id = v_org_id
    FOR UPDATE;
  END IF;

  -- Admin unlimited flag takes highest precedence
  IF v_row.is_unlimited THEN
    UPDATE organization_storage_usage
    SET    used_bytes  = used_bytes + p_bytes,
           updated_at  = now()
    WHERE  organization_id = v_org_id;

    RETURN json_build_object(
      'allowed',      true,
      'used_bytes',   v_row.used_bytes + p_bytes,
      'limit_bytes',  v_default_limit,
      'is_unlimited', true
    );
  END IF;

  -- Determine effective limit:
  -- Priority: admin custom limit > plan limit > platform default
  IF v_row.storage_limit_bytes IS NOT NULL THEN
    v_effective := v_row.storage_limit_bytes;
  ELSIF v_plan_limit IS NOT NULL THEN
    v_effective := v_plan_limit;
  ELSE
    v_effective := v_default_limit;
  END IF;

  IF (v_row.used_bytes + p_bytes) > v_effective THEN
    RETURN json_build_object(
      'allowed',      false,
      'used_bytes',   v_row.used_bytes,
      'limit_bytes',  v_effective,
      'is_unlimited', false
    );
  END IF;

  UPDATE organization_storage_usage
  SET    used_bytes  = used_bytes + p_bytes,
         updated_at  = now()
  WHERE  organization_id = v_org_id;

  RETURN json_build_object(
    'allowed',      true,
    'used_bytes',   v_row.used_bytes + p_bytes,
    'limit_bytes',  v_effective,
    'is_unlimited', false
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.increment_agency_storage_usage(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_agency_storage_usage(BIGINT) TO authenticated;

-- ─── 13. Trigger: auto-create subscription row for new orgs ──────────────────

CREATE OR REPLACE FUNCTION public.auto_create_org_subscription()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.organization_subscriptions (
    organization_id,
    status,
    trial_ends_at
  )
  VALUES (NEW.id, 'trialing', now() + INTERVAL '30 days')
  ON CONFLICT (organization_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_auto_create_org_subscription ON public.organizations;
CREATE TRIGGER trigger_auto_create_org_subscription
  AFTER INSERT ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_create_org_subscription();

-- ─── 14. Backfill: existing organizations ────────────────────────────────────
--
-- Orgs created before this migration get a subscription row.
-- If org.created_at + 30 days is in the past → trial expired → status 'canceled'.
-- This avoids silently granting free access to existing orgs.

INSERT INTO public.organization_subscriptions (
  organization_id,
  status,
  trial_ends_at,
  created_at
)
SELECT
  id,
  CASE
    WHEN (created_at + INTERVAL '30 days') > now() THEN 'trialing'
    ELSE 'canceled'
  END,
  created_at + INTERVAL '30 days',
  created_at
FROM public.organizations
ON CONFLICT (organization_id) DO NOTHING;

-- ─── 15. Sync plan limits into agency_usage_limits for existing subscriptions ─
--
-- After backfill, update daily_swipe_limit to match the plan where a plan exists.

UPDATE public.agency_usage_limits ul
SET    daily_swipe_limit = public.get_plan_swipe_limit(s.plan),
       updated_at        = now()
FROM   public.organization_subscriptions s
WHERE  s.organization_id = ul.organization_id
  AND  s.plan IS NOT NULL;
