-- Live reconcile: Agency Basic storage = 10 GB (Apr 2026 product entitlements).
--
-- Idempotent follow-up to 20261330 when that migration was not yet applied on production,
-- or when legacy rows still pin the old 5 GB default in storage_limit_bytes.
--
-- 1) Clear stale legacy 5 GB overrides (not intentional admin custom caps).
-- 2) Re-assert plan-aware 10 GB RPCs + expose has_custom_storage_limit for UI.

UPDATE public.organization_storage_usage
SET storage_limit_bytes = NULL,
    updated_at = now()
WHERE storage_limit_bytes = 5368709120
  AND COALESCE(is_unlimited, false) = false;

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
    WHEN 'trial'             THEN  10737418240   -- same as Basic during trial
    WHEN 'client'            THEN NULL           -- unlimited (sentinel)
    ELSE 10737418240                             -- agency default = Basic
  END;
END;
$$;

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
  v_default_limit  BIGINT := 10737418240; -- 10 GB (Basic / trial fallback)
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

CREATE OR REPLACE FUNCTION public.get_my_agency_storage_usage()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO off
AS $function$
DECLARE
  v_org_id         UUID;
  v_row            organization_storage_usage%ROWTYPE;
  v_plan           TEXT;
  v_plan_limit     BIGINT;
  v_default_limit  BIGINT := 10737418240;  -- 10 GB (Basic / trial fallback)
  v_effective      BIGINT;
  v_has_custom     BOOLEAN;
BEGIN
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

  INSERT INTO organization_storage_usage (organization_id, used_bytes)
  VALUES (v_org_id, 0)
  ON CONFLICT (organization_id) DO NOTHING;

  SELECT * INTO v_row
  FROM   organization_storage_usage
  WHERE  organization_id = v_org_id;

  SELECT plan INTO v_plan
  FROM   organization_subscriptions
  WHERE  organization_id = v_org_id;

  v_plan_limit := public.get_plan_storage_limit(v_plan);
  v_has_custom := v_row.storage_limit_bytes IS NOT NULL;

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
    'organization_id',          v_org_id,
    'used_bytes',               COALESCE(v_row.used_bytes, 0),
    'limit_bytes',              COALESCE(v_effective, v_default_limit),
    'effective_limit_bytes',    v_effective,
    'is_unlimited',             COALESCE(v_row.is_unlimited, false),
    'has_custom_storage_limit', v_has_custom
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_org_storage_usage(p_org_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO off
AS $function$
DECLARE
  v_row            organization_storage_usage%ROWTYPE;
  v_plan           TEXT;
  v_plan_limit     BIGINT;
  v_default_limit  BIGINT := 10737418240;  -- 10 GB
  v_effective      BIGINT;
BEGIN
  PERFORM public.assert_is_admin();

  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = p_org_id) THEN
    RETURN json_build_object('error', 'Organization not found');
  END IF;

  INSERT INTO organization_storage_usage (organization_id, used_bytes)
  VALUES (p_org_id, 0)
  ON CONFLICT (organization_id) DO NOTHING;

  SELECT * INTO v_row
  FROM   organization_storage_usage
  WHERE  organization_id = p_org_id;

  SELECT plan INTO v_plan
  FROM   organization_subscriptions
  WHERE  organization_id = p_org_id;

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
    'organization_id',       v_row.organization_id,
    'used_bytes',            v_row.used_bytes,
    'storage_limit_bytes',   v_row.storage_limit_bytes,
    'is_unlimited',          v_row.is_unlimited,
    'effective_limit_bytes', v_effective
  );
END;
$function$;
