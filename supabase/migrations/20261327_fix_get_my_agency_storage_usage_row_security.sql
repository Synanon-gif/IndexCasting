-- Fix: get_my_agency_storage_usage missing SET row_security TO off + ORDER BY
--
-- Root Cause: Migration 20260721_storage_rpcs_row_security_off.sql fixed
-- increment_agency_storage_usage and decrement_agency_storage_usage with
-- SET row_security TO off + ORDER BY om.created_at ASC, but OMITTED
-- get_my_agency_storage_usage.
--
-- Effect without this fix:
--   1. For new agencies (no row in organization_storage_usage yet):
--      INSERT ON CONFLICT DO NOTHING is silently blocked by RLS
--      (no INSERT policy for 'authenticated' on organization_storage_usage).
--      The row is never created. Subsequent SELECT returns empty.
--      Function returns {used_bytes: 0}. Widget shows "0 Storage Usage"
--      even after files are uploaded.
--
--   2. For multi-org agency users:
--      LIMIT 1 without ORDER BY picks a non-deterministic org, while
--      increment/decrement consistently pick the oldest org. This causes
--      the widget to read the wrong org's counter.
--
-- Fix: Add SET row_security TO off (mirrors increment/decrement) and
--      ORDER BY om.created_at ASC for deterministic org resolution.
--      Also aligns limit logic with get_plan_storage_limit() so displayed
--      limit matches actual enforced limit in increment_agency_storage_usage.
--
-- Scope: ONE function, identical signature and return fields.
-- No schema changes, no RLS changes, no frontend changes needed.

CREATE OR REPLACE FUNCTION public.get_my_agency_storage_usage()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO off          -- FIX 1: was missing (mirrors increment/decrement)
AS $function$
DECLARE
  v_org_id         UUID;
  v_row            organization_storage_usage%ROWTYPE;
  v_plan           TEXT;
  v_plan_limit     BIGINT;
  v_default_limit  BIGINT := 5368709120;  -- 5 GB (consistent with increment)
  v_effective      BIGINT;
BEGIN
  -- FIX 2: ORDER BY om.created_at ASC for deterministic org resolution
  -- (consistent with increment_agency_storage_usage and can_access_platform).
  SELECT om.organization_id INTO v_org_id
  FROM   organization_members om
  JOIN   organizations o ON o.id = om.organization_id
  WHERE  om.user_id = auth.uid()
    AND  o.type     = 'agency'
  ORDER BY om.created_at ASC
  LIMIT  1;

  IF v_org_id IS NULL THEN
    RETURN json_build_object('error', 'No agency organization found for current user');
  END IF;

  -- Initialise row if not present yet.
  -- Now succeeds because SET row_security TO off bypasses the missing INSERT
  -- policy for 'authenticated' on organization_storage_usage.
  INSERT INTO organization_storage_usage (organization_id, used_bytes)
  VALUES (v_org_id, 0)
  ON CONFLICT (organization_id) DO NOTHING;

  SELECT * INTO v_row
  FROM   organization_storage_usage
  WHERE  organization_id = v_org_id;

  -- FIX 3: Use get_plan_storage_limit() for consistent limit display
  -- (same source used by increment_agency_storage_usage).
  SELECT plan INTO v_plan
  FROM   organization_subscriptions
  WHERE  organization_id = v_org_id;

  v_plan_limit := public.get_plan_storage_limit(v_plan);

  IF COALESCE(v_row.is_unlimited, false) THEN
    v_effective := NULL;
  ELSIF v_row.storage_limit_bytes IS NOT NULL THEN
    v_effective := v_row.storage_limit_bytes;
  ELSIF v_plan_limit IS NOT NULL THEN
    v_effective := v_plan_limit;
  ELSE
    v_effective := v_default_limit;
  END IF;

  RETURN json_build_object(
    'organization_id',       v_org_id,
    'used_bytes',            COALESCE(v_row.used_bytes, 0),
    'limit_bytes',           COALESCE(v_effective, v_default_limit),
    'effective_limit_bytes', v_effective,
    'is_unlimited',          COALESCE(v_row.is_unlimited, false)
  );
END;
$function$;
