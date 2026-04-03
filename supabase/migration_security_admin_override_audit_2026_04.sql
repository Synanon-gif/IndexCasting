-- =============================================================================
-- Security Hardening: Admin Override Audit Logging + RLS Tightening
--
-- Addresses three findings from the 2026-04 Admin Paywall Override Security Audit:
--
--   FINDING-01 (HIGH): admin_set_bypass_paywall() and admin_set_org_plan() do not
--     write to admin_logs. All other admin RPCs log their actions; these two were
--     missed. Without audit entries, override changes are untraceable (SOC2,
--     DSGVO Rechenschaftspflicht).
--     Fix: Add INSERT INTO admin_logs at the end of both functions.
--
--   FINDING-02 (MEDIUM): admin_logs RLS policy "Admins can manage audit logs" is
--     FOR ALL — admins can DELETE their own audit trail entries, undermining the
--     integrity of the log.
--     Fix: Split into two policies — SELECT and INSERT only. No UPDATE / DELETE
--     for any authenticated role.
--
--   FINDING-03 (MEDIUM): admin_full_access_overrides RLS policy on admin_overrides
--     is FOR ALL — platform admins can write directly to admin_overrides without
--     going through the SECURITY DEFINER RPC. This bypasses the audit log added
--     by FINDING-01's fix.
--     Fix: Restrict to SELECT only. All writes must go through
--     admin_set_bypass_paywall() which is now the sole, audited write path.
--
-- Run AFTER migration_paywall_billing.sql and migration_security_audit_2026_04.sql.
-- Idempotent — safe to run multiple times.
-- =============================================================================


-- ─── FINDING-01: Replace admin_set_bypass_paywall() with audit logging ────────

CREATE OR REPLACE FUNCTION public.admin_set_bypass_paywall(
  p_org_id      UUID,
  p_bypass      BOOLEAN,
  p_custom_plan TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev_bypass      BOOLEAN;
  v_prev_custom_plan TEXT;
BEGIN
  -- Hard server-side guard — identical pattern to all other admin RPCs.
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'admin_set_bypass_paywall: unauthorized';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = p_org_id) THEN
    RAISE EXCEPTION 'admin_set_bypass_paywall: organization not found';
  END IF;

  -- Capture previous state for audit diff.
  SELECT bypass_paywall, custom_plan
  INTO   v_prev_bypass, v_prev_custom_plan
  FROM   admin_overrides
  WHERE  organization_id = p_org_id;

  INSERT INTO admin_overrides (organization_id, bypass_paywall, custom_plan, updated_at)
  VALUES (p_org_id, p_bypass, p_custom_plan, now())
  ON CONFLICT (organization_id) DO UPDATE
    SET bypass_paywall = p_bypass,
        custom_plan    = p_custom_plan,
        updated_at     = now();

  -- Audit log — required for SOC2 / DSGVO traceability (FINDING-01).
  INSERT INTO public.admin_logs (admin_id, action, details)
  VALUES (
    auth.uid(),
    'set_bypass_paywall',
    jsonb_build_object(
      'organization_id',      p_org_id,
      'bypass_paywall',       p_bypass,
      'custom_plan',          p_custom_plan,
      'previous_bypass',      v_prev_bypass,
      'previous_custom_plan', v_prev_custom_plan
    )
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.admin_set_bypass_paywall(UUID, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_bypass_paywall(UUID, BOOLEAN, TEXT) TO authenticated;


-- ─── FINDING-01: Replace admin_set_org_plan() with audit logging ──────────────

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
DECLARE
  v_prev_plan   TEXT;
  v_prev_status TEXT;
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

  -- Capture previous state for audit diff.
  SELECT plan, status
  INTO   v_prev_plan, v_prev_status
  FROM   organization_subscriptions
  WHERE  organization_id = p_org_id;

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

  -- Audit log — required for SOC2 / DSGVO traceability (FINDING-01).
  INSERT INTO public.admin_logs (admin_id, action, details)
  VALUES (
    auth.uid(),
    'set_org_plan',
    jsonb_build_object(
      'organization_id', p_org_id,
      'plan',            p_plan,
      'status',          p_status,
      'previous_plan',   v_prev_plan,
      'previous_status', v_prev_status
    )
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.admin_set_org_plan(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_org_plan(UUID, TEXT, TEXT) TO authenticated;


-- ─── FINDING-02: Restrict admin_logs RLS to SELECT + INSERT only ──────────────
--
-- Previous policy was FOR ALL — admins could DELETE their own audit entries.
-- Audit logs must be append-only for all roles including admins.

DROP POLICY IF EXISTS "Admins can manage audit logs" ON public.admin_logs;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'admin_logs'
      AND policyname = 'admin_logs_select'
  ) THEN
    CREATE POLICY "admin_logs_select"
      ON public.admin_logs
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE)
      );
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'admin_logs'
      AND policyname = 'admin_logs_insert'
  ) THEN
    CREATE POLICY "admin_logs_insert"
      ON public.admin_logs
      FOR INSERT
      TO authenticated
      WITH CHECK (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE)
      );
  END IF;
END;
$$;

-- Explicit denial of UPDATE / DELETE is implicit when no policy covers them
-- (RLS denies by default). No additional policy needed.


-- ─── FINDING-03: Restrict admin_full_access_overrides to SELECT only ──────────
--
-- Previous policy was FOR ALL — admins could write directly to admin_overrides
-- without going through the SECURITY DEFINER RPC, bypassing the audit log.
-- All writes must go exclusively through admin_set_bypass_paywall().

DROP POLICY IF EXISTS "admin_full_access_overrides" ON public.admin_overrides;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'admin_overrides'
      AND policyname = 'admin_select_overrides'
  ) THEN
    CREATE POLICY "admin_select_overrides"
      ON public.admin_overrides
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE)
      );
  END IF;
END;
$$;

-- No INSERT / UPDATE / DELETE policy for admins on admin_overrides.
-- admin_set_bypass_paywall() is SECURITY DEFINER and bypasses RLS internally —
-- it is the only permitted write path.


-- ─── Verification ─────────────────────────────────────────────────────────────
-- After running, confirm policies:
--
-- SELECT policyname, cmd FROM pg_policies
-- WHERE schemaname = 'public' AND tablename IN ('admin_logs', 'admin_overrides')
-- ORDER BY tablename, policyname;
--
-- Expected for admin_logs:    admin_logs_insert (INSERT), admin_logs_select (SELECT)
-- Expected for admin_overrides: admin_select_overrides (SELECT), org_members_select_own_override (SELECT)
--
-- Confirm functions exist with updated bodies:
-- SELECT routine_name FROM information_schema.routines
-- WHERE routine_schema = 'public'
--   AND routine_name IN ('admin_set_bypass_paywall', 'admin_set_org_plan');
