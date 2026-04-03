-- =============================================================================
-- Org Metrics RPC (Owner-only reporting)
--
-- get_org_metrics(p_org_id):
--   Returns total_options, confirmed_options, conversion_rate.
--   Access: restricted to organization owners only.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_org_metrics(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_owner       boolean;
  v_org_type       text;
  v_agency_id      uuid;
  v_total          integer := 0;
  v_confirmed      integer := 0;
  v_conversion     numeric := 0;
BEGIN
  -- ── Security: owner-only access ────────────────────────────────────────────
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members om
    WHERE om.organization_id = p_org_id
      AND om.user_id = auth.uid()
      AND om.role = 'owner'
  ) INTO v_is_owner;

  IF NOT v_is_owner THEN
    RAISE EXCEPTION 'Access denied: owner role required';
  END IF;

  -- ── Detect org type ────────────────────────────────────────────────────────
  SELECT o.type::text, o.agency_id
  INTO   v_org_type, v_agency_id
  FROM   public.organizations o
  WHERE  o.id = p_org_id;

  -- ── Count option requests ──────────────────────────────────────────────────
  IF v_org_type = 'agency' AND v_agency_id IS NOT NULL THEN
    SELECT
      COUNT(*),
      COUNT(*) FILTER (WHERE final_status = 'job_confirmed')
    INTO v_total, v_confirmed
    FROM public.option_requests
    WHERE agency_id = v_agency_id;
  ELSE
    SELECT
      COUNT(*),
      COUNT(*) FILTER (WHERE final_status = 'job_confirmed')
    INTO v_total, v_confirmed
    FROM public.option_requests
    WHERE organization_id = p_org_id;
  END IF;

  -- ── Conversion rate ────────────────────────────────────────────────────────
  IF v_total > 0 THEN
    v_conversion := ROUND((v_confirmed::numeric / v_total::numeric) * 100, 1);
  END IF;

  RETURN jsonb_build_object(
    'total_options',     v_total,
    'confirmed_options', v_confirmed,
    'conversion_rate',   v_conversion
  );
END;
$$;

ALTER FUNCTION public.get_org_metrics(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_org_metrics(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_org_metrics(uuid) TO authenticated;
