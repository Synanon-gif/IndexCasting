-- =============================================================================
-- 20260534: check_calendar_conflict enum-safe status filter + option_requests
-- INSERT paywall bound to organization_id (not oldest membership).
--
-- P0: COALESCE(orq.status, '') coerced '' to option_request_status → 22P02.
--     Use COALESCE(orq.status::text, '') NOT IN (...) instead.
-- P1: option_requests_insert_client used has_platform_access() → can_access_platform
--     LIMIT 1 org; get_discovery_models gates on explicit client org only.
--     Add has_platform_access_for_organization(org_id) for WITH CHECK.
-- =============================================================================

-- ─── 1) Paywall helper: explicit organization (caller must be member) ───────

CREATE OR REPLACE FUNCTION public.has_platform_access_for_organization(p_organization_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_org_type      TEXT;
  v_override      public.admin_overrides%ROWTYPE;
  v_sub           public.organization_subscriptions%ROWTYPE;
  v_caller_email  TEXT;
  v_email_hash    TEXT;
  v_trial_blocked BOOLEAN := false;
BEGIN
  IF auth.uid() IS NULL OR p_organization_id IS NULL THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM   public.organization_members m
    WHERE  m.organization_id = p_organization_id
      AND  m.user_id = auth.uid()
  ) THEN
    RETURN false;
  END IF;

  SELECT o.type::text
  INTO   v_org_type
  FROM   public.organizations o
  WHERE  o.id = p_organization_id;

  IF v_org_type IS NULL THEN
    RETURN false;
  END IF;

  SELECT * INTO v_override
  FROM   public.admin_overrides
  WHERE  organization_id = p_organization_id;

  IF FOUND AND v_override.bypass_paywall THEN
    RETURN true;
  END IF;

  SELECT * INTO v_sub
  FROM   public.organization_subscriptions
  WHERE  organization_id = p_organization_id;

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
            AND  ute.source_org IS DISTINCT FROM p_organization_id
        ) INTO v_trial_blocked;
      END IF;

      IF v_trial_blocked THEN
        RETURN false;
      END IF;

      RETURN true;
    END IF;

    IF v_sub.status IN ('active', 'trialing') THEN
      RETURN true;
    END IF;
  END IF;

  RETURN false;
END;
$$;

ALTER FUNCTION public.has_platform_access_for_organization(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.has_platform_access_for_organization(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_platform_access_for_organization(uuid) TO authenticated;

COMMENT ON FUNCTION public.has_platform_access_for_organization(uuid) IS
  'Paywall for a specific organization: caller must be a member; same allow/deny '
  'order as can_access_platform (admin_override → trial_active → subscription_active). '
  '20260534: fixes option_requests INSERT vs multi-org / discover org mismatch.';

-- ─── 2) option_requests INSERT: paywall on row organization_id when set ────

DROP POLICY IF EXISTS option_requests_insert_client ON public.option_requests;

CREATE POLICY option_requests_insert_client
  ON public.option_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (
    client_id = auth.uid()
    AND (
      (
        option_requests.organization_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM   public.organization_members m
          WHERE  m.organization_id = option_requests.organization_id
            AND  m.user_id = auth.uid()
        )
        AND public.has_platform_access_for_organization(option_requests.organization_id)
      )
      OR (
        option_requests.organization_id IS NULL
        AND public.has_platform_access()
      )
    )
  );

COMMENT ON POLICY option_requests_insert_client ON public.option_requests IS
  'Clients create option requests: client_id = auth.uid(); if organization_id set, '
  'membership + has_platform_access_for_organization(organization_id); legacy NULL '
  'organization_id keeps global has_platform_access(). 20260534.';

-- ─── 3) check_calendar_conflict — enum-safe option_requests status filter ──

CREATE OR REPLACE FUNCTION public.check_calendar_conflict(
  p_model_id uuid,
  p_date     date,
  p_start    time,
  p_end      time
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_entries   jsonb;
  v_count     integer;
  v_agency_id uuid;
  v_allowed   boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT m.agency_id INTO v_agency_id
  FROM public.models m
  WHERE m.id = p_model_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Model not found';
  END IF;

  v_allowed :=
    public.is_current_user_admin()
    OR EXISTS (
      SELECT 1
      FROM public.organizations o
      JOIN public.organization_members om ON om.organization_id = o.id
      WHERE o.agency_id = v_agency_id
        AND o.type = 'agency'
        AND om.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.option_requests orq
      WHERE orq.model_id = p_model_id
        AND COALESCE(orq.status::text, '') NOT IN ('rejected', 'cancelled')
        AND (
          EXISTS (
            SELECT 1
            FROM public.organization_members om
            WHERE om.user_id = auth.uid()
              AND orq.client_organization_id IS NOT NULL
              AND om.organization_id = orq.client_organization_id
          )
          OR EXISTS (
            SELECT 1
            FROM public.organizations oc
            JOIN public.organization_members om ON om.organization_id = oc.id
            WHERE oc.id = orq.organization_id
              AND oc.type = 'client'
              AND om.user_id = auth.uid()
          )
        )
    )
    OR (
      public.has_platform_access()
      AND public.caller_is_client_org_member()
      AND EXISTS (
        SELECT 1
        FROM public.models m
        WHERE m.id = p_model_id
          AND (m.is_visible_commercial = true OR m.is_visible_fashion = true)
          AND m.name IS NOT NULL
          AND trim(m.name) <> ''
          AND EXISTS (
            SELECT 1
            FROM public.model_agency_territories mat
            WHERE mat.model_id = m.id
          )
          AND (
            array_length(m.portfolio_images, 1) > 0
            OR EXISTS (
              SELECT 1
              FROM public.model_photos mp
              WHERE mp.model_id = m.id
                AND mp.photo_type = 'portfolio'
                AND mp.is_visible_to_clients = true
                AND COALESCE(mp.visible, true) = true
            )
          )
      )
    );

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Access denied: no permission to view this model''s calendar';
  END IF;

  SELECT
    COUNT(*),
    jsonb_agg(jsonb_build_object(
      'id',         ce.id,
      'entry_type', ce.entry_type,
      'start_time', ce.start_time,
      'end_time',   ce.end_time,
      'title',      ce.title
    ))
  INTO v_count, v_entries
  FROM public.calendar_entries ce
  WHERE ce.model_id = p_model_id
    AND ce.date = p_date
    AND ce.entry_type IN ('option', 'casting', 'job')
    AND (
      CASE
        WHEN ce.start_time IS NULL AND ce.end_time IS NULL THEN
          p_start IS NULL AND p_end IS NULL
        ELSE
          COALESCE(ce.start_time, '00:00:00'::time)
            < COALESCE(p_end, '23:59:59'::time)
          AND COALESCE(ce.end_time, '23:59:59'::time)
            > COALESCE(p_start, '00:00:00'::time)
      END
    );

  RETURN jsonb_build_object(
    'has_conflict',        v_count > 0,
    'conflicting_entries', COALESCE(v_entries, '[]'::jsonb)
  );
END;
$$;

ALTER FUNCTION public.check_calendar_conflict(uuid, date, time, time) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.check_calendar_conflict(uuid, date, time, time) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_calendar_conflict(uuid, date, time, time) TO authenticated;

COMMENT ON FUNCTION public.check_calendar_conflict(uuid, date, time, time) IS
  'Calendar overlap check for option/casting/job entries. '
  '20260529: portfolio_images OR visible portfolio model_photos (§27.1). '
  '20260534: option_requests status filter via status::text (no COALESCE to enum).';

-- ─── Verification ───────────────────────────────────────────────────────────

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'check_calendar_conflict'
  ), 'FAIL: check_calendar_conflict missing after migration';

  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'has_platform_access_for_organization'
  ), 'FAIL: has_platform_access_for_organization missing after migration';

  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'check_calendar_conflict'
      AND pg_get_functiondef(p.oid) ILIKE '%orq.status::text%'
  ), 'FAIL: check_calendar_conflict missing orq.status::text (enum-safe filter)';
END;
$$;
