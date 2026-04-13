-- P3 FRAGILE: Add SET row_security TO off and deterministic ORDER BY
-- to storage-metering RPCs.
--
-- Problem 1: No explicit row_security setting — project rule §I requires
-- SET row_security TO off for SECURITY DEFINER functions reading RLS tables.
--
-- Problem 2: LIMIT 1 on organization_members without ORDER BY is
-- non-deterministic for multi-org users. Adding ORDER BY created_at ASC
-- makes behavior consistent (oldest membership = same as paywall RPC).
--
-- Signature stays IDENTICAL — no frontend changes needed.
-- Business logic stays IDENTICAL — only infrastructure hardening.

-- ── increment_agency_storage_usage ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.increment_agency_storage_usage(p_bytes bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO off
AS $function$
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

  v_access := public.can_access_platform();
  IF NOT (v_access->>'allowed')::BOOLEAN THEN
    RETURN json_build_object(
      'allowed', false,
      'error',   'platform_access_denied',
      'reason',  v_access->>'reason'
    );
  END IF;

  -- Deterministic: oldest agency membership (matches paywall convention)
  SELECT om.organization_id INTO v_org_id
  FROM   organization_members om
  JOIN   organizations o ON o.id = om.organization_id
  WHERE  om.user_id = auth.uid()
    AND  o.type     = 'agency'
  ORDER BY om.created_at ASC
  LIMIT  1;

  IF v_org_id IS NULL THEN
    RETURN json_build_object('allowed', true, 'used_bytes', 0, 'limit_bytes', v_default_limit, 'is_unlimited', false);
  END IF;

  SELECT plan INTO v_plan
  FROM   organization_subscriptions
  WHERE  organization_id = v_org_id;

  v_plan_limit := public.get_plan_storage_limit(v_plan);

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
$function$;

-- ── decrement_agency_storage_usage ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.decrement_agency_storage_usage(p_bytes bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO off
AS $function$
DECLARE
  v_org_id   UUID;
  v_new_used BIGINT;
BEGIN
  IF p_bytes <= 0 THEN
    RETURN 0;
  END IF;

  -- Deterministic: oldest agency membership (matches paywall convention)
  SELECT om.organization_id INTO v_org_id
  FROM   organization_members om
  JOIN   organizations o ON o.id = om.organization_id
  WHERE  om.user_id = auth.uid()
    AND  o.type     = 'agency'
  ORDER BY om.created_at ASC
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RETURN 0;
  END IF;

  IF p_bytes > 104857600 THEN -- 100 MB
    INSERT INTO security_events (user_id, org_id, type, metadata)
    VALUES (
      auth.uid(),
      v_org_id,
      'large_storage_decrement',
      json_build_object('p_bytes', p_bytes, 'org_id', v_org_id)
    );
  END IF;

  UPDATE organization_storage_usage
  SET    used_bytes  = GREATEST(0, used_bytes - p_bytes),
         updated_at  = now()
  WHERE  organization_id = v_org_id
  RETURNING used_bytes INTO v_new_used;

  RETURN COALESCE(v_new_used, 0);
END;
$function$;
