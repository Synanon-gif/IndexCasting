-- =============================================================================
-- Monetization Layer 1: Agency Swipe Limits
--
-- Creates the agency_usage_limits table with RLS policies.
-- Adds SECURITY DEFINER RPCs for atomic swipe tracking and admin control.
-- Adds a trigger to auto-create a limit row for every new agency organization.
-- Backfills existing agency organizations with the default limit.
--
-- Run after Phase 13 (migration_admin_org_rls_and_full_backfill.sql).
-- =============================================================================

-- ─── 1. Table ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.agency_usage_limits (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID        NOT NULL UNIQUE
                                   REFERENCES public.organizations(id) ON DELETE CASCADE,
  daily_swipe_limit  INTEGER     NOT NULL DEFAULT 10,
  swipes_used_today  INTEGER     NOT NULL DEFAULT 0,
  last_reset_date    DATE        NOT NULL DEFAULT CURRENT_DATE,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── 2. RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE public.agency_usage_limits ENABLE ROW LEVEL SECURITY;

-- Organization members can read their own usage row.
DROP POLICY IF EXISTS "agency_members_select_own_usage" ON public.agency_usage_limits;
CREATE POLICY "agency_members_select_own_usage"
  ON public.agency_usage_limits
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = agency_usage_limits.organization_id
        AND om.user_id = auth.uid()
    )
  );

-- Admins have full access (SELECT, INSERT, UPDATE, DELETE).
-- Normal users never INSERT/UPDATE directly — all writes go through SECURITY DEFINER RPCs.
DROP POLICY IF EXISTS "admin_full_access_usage_limits" ON public.agency_usage_limits;
CREATE POLICY "admin_full_access_usage_limits"
  ON public.agency_usage_limits
  FOR ALL
  TO authenticated
  USING     (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE))
  WITH CHECK(EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE));

-- ─── 3. RPC: get_my_agency_usage_limit ───────────────────────────────────────
-- Returns usage data for the current user's agency organization.
-- Auto-creates a default row if none exists yet.
-- Resets swipes_used_today when last_reset_date is before today.

CREATE OR REPLACE FUNCTION public.get_my_agency_usage_limit()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id  UUID;
  v_row     agency_usage_limits%ROWTYPE;
  v_today   DATE := CURRENT_DATE;
BEGIN
  -- Identify the caller's agency organization.
  SELECT om.organization_id INTO v_org_id
  FROM   organization_members om
  JOIN   organizations o ON o.id = om.organization_id
  WHERE  om.user_id = auth.uid()
    AND  o.type    = 'agency'
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RETURN json_build_object('error', 'No agency organization found for current user');
  END IF;

  -- Auto-create if the row is missing (e.g. legacy orgs before the trigger).
  INSERT INTO agency_usage_limits (organization_id, daily_swipe_limit, swipes_used_today, last_reset_date)
  VALUES (v_org_id, 10, 0, v_today)
  ON CONFLICT (organization_id) DO NOTHING;

  SELECT * INTO v_row FROM agency_usage_limits WHERE organization_id = v_org_id;

  -- Daily reset: if the stored date is before today, zero out the counter.
  IF v_row.last_reset_date IS DISTINCT FROM v_today THEN
    UPDATE agency_usage_limits
    SET    swipes_used_today = 0,
           last_reset_date   = v_today,
           updated_at        = now()
    WHERE  organization_id = v_org_id
    RETURNING * INTO v_row;
  END IF;

  RETURN json_build_object(
    'organization_id',   v_org_id,
    'swipes_used_today', v_row.swipes_used_today,
    'daily_swipe_limit', v_row.daily_swipe_limit,
    'last_reset_date',   v_row.last_reset_date
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.get_my_agency_usage_limit() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_agency_usage_limit() TO authenticated;

-- ─── 4. RPC: increment_my_agency_swipe_count ─────────────────────────────────
-- Atomically checks the daily limit and increments the counter if allowed.
-- Uses FOR UPDATE to prevent race conditions when multiple members swipe at once.
-- Returns { allowed, swipes_used, limit }.

CREATE OR REPLACE FUNCTION public.increment_my_agency_swipe_count()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id  UUID;
  v_row     agency_usage_limits%ROWTYPE;
  v_today   DATE := CURRENT_DATE;
BEGIN
  -- Identify the caller's agency organization.
  SELECT om.organization_id INTO v_org_id
  FROM   organization_members om
  JOIN   organizations o ON o.id = om.organization_id
  WHERE  om.user_id = auth.uid()
    AND  o.type    = 'agency'
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RETURN json_build_object('allowed', false, 'error', 'No agency organization found for current user');
  END IF;

  -- Lock the row to prevent concurrent increments (race-condition safe).
  SELECT * INTO v_row FROM agency_usage_limits WHERE organization_id = v_org_id FOR UPDATE;

  IF NOT FOUND THEN
    -- Row missing: insert with default and re-lock.
    INSERT INTO agency_usage_limits (organization_id, daily_swipe_limit, swipes_used_today, last_reset_date)
    VALUES (v_org_id, 10, 0, v_today)
    ON CONFLICT (organization_id) DO NOTHING;
    SELECT * INTO v_row FROM agency_usage_limits WHERE organization_id = v_org_id FOR UPDATE;
  END IF;

  -- Daily reset.
  IF v_row.last_reset_date IS DISTINCT FROM v_today THEN
    UPDATE agency_usage_limits
    SET    swipes_used_today = 0,
           last_reset_date   = v_today,
           updated_at        = now()
    WHERE  organization_id = v_org_id;
    v_row.swipes_used_today := 0;
    v_row.last_reset_date   := v_today;
  END IF;

  -- Block if limit reached.
  IF v_row.swipes_used_today >= v_row.daily_swipe_limit THEN
    RETURN json_build_object(
      'allowed',     false,
      'swipes_used', v_row.swipes_used_today,
      'limit',       v_row.daily_swipe_limit
    );
  END IF;

  -- Allowed: increment atomically.
  UPDATE agency_usage_limits
  SET    swipes_used_today = swipes_used_today + 1,
         updated_at        = now()
  WHERE  organization_id = v_org_id;

  RETURN json_build_object(
    'allowed',     true,
    'swipes_used', v_row.swipes_used_today + 1,
    'limit',       v_row.daily_swipe_limit
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.increment_my_agency_swipe_count() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_my_agency_swipe_count() TO authenticated;

-- ─── 5. RPC: admin_set_agency_swipe_limit ────────────────────────────────────
-- Sets (or upserts) the daily swipe limit for a given organization.
-- Caller must be an admin; enforced inside the function.

CREATE OR REPLACE FUNCTION public.admin_set_agency_swipe_limit(
  p_organization_id UUID,
  p_limit           INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'admin_set_agency_swipe_limit: unauthorized';
  END IF;

  IF p_limit < 0 THEN
    RAISE EXCEPTION 'admin_set_agency_swipe_limit: limit must be >= 0';
  END IF;

  INSERT INTO agency_usage_limits (organization_id, daily_swipe_limit, swipes_used_today, last_reset_date)
  VALUES (p_organization_id, p_limit, 0, CURRENT_DATE)
  ON CONFLICT (organization_id) DO UPDATE
    SET daily_swipe_limit = p_limit,
        updated_at        = now();
END;
$$;

REVOKE ALL    ON FUNCTION public.admin_set_agency_swipe_limit(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_agency_swipe_limit(UUID, INTEGER) TO authenticated;

-- ─── 6. RPC: admin_reset_agency_swipe_count ──────────────────────────────────
-- Resets swipes_used_today to 0 for a given organization, effective immediately.

CREATE OR REPLACE FUNCTION public.admin_reset_agency_swipe_count(
  p_organization_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'admin_reset_agency_swipe_count: unauthorized';
  END IF;

  UPDATE agency_usage_limits
  SET    swipes_used_today = 0,
         last_reset_date   = CURRENT_DATE,
         updated_at        = now()
  WHERE  organization_id = p_organization_id;
END;
$$;

REVOKE ALL    ON FUNCTION public.admin_reset_agency_swipe_count(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_reset_agency_swipe_count(UUID) TO authenticated;

-- ─── 7. Trigger: auto-create limit row for new agency organizations ───────────

CREATE OR REPLACE FUNCTION public.auto_create_agency_usage_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.type = 'agency' THEN
    INSERT INTO public.agency_usage_limits (
      organization_id,
      daily_swipe_limit,
      swipes_used_today,
      last_reset_date
    )
    VALUES (NEW.id, 10, 0, CURRENT_DATE)
    ON CONFLICT (organization_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_auto_create_agency_usage_limit ON public.organizations;
CREATE TRIGGER trigger_auto_create_agency_usage_limit
  AFTER INSERT ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_create_agency_usage_limit();

-- ─── 8. Backfill: existing agency organizations ───────────────────────────────

INSERT INTO public.agency_usage_limits (
  organization_id,
  daily_swipe_limit,
  swipes_used_today,
  last_reset_date
)
SELECT id, 10, 0, CURRENT_DATE
FROM   public.organizations
WHERE  type = 'agency'
ON CONFLICT (organization_id) DO NOTHING;
