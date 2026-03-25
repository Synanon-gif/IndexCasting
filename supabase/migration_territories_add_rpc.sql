-- =============================================================================
-- Additive territory assignment: add_model_territories RPC
--
-- Purpose: add countries to a model's territories WITHOUT deleting existing ones.
-- Used by bulk selection under "My Models" — the bulk action should be additive
-- so that individually-set territories are preserved.
--
-- Contrast with save_model_territories (migration_territories_rpc_definitive.sql)
-- which fully REPLACES the territory list — used only for individual model settings.
-- =============================================================================

DROP FUNCTION IF EXISTS public.add_model_territories(UUID, UUID, TEXT[]);

CREATE OR REPLACE FUNCTION public.add_model_territories(
  p_model_id      UUID,
  p_agency_id     UUID,
  p_country_codes TEXT[]
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        UUID    := auth.uid();
  v_authorized BOOLEAN := FALSE;
  v_code       TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Check 1: direct org owner_id match
  SELECT EXISTS (
    SELECT 1
    FROM organizations o
    WHERE o.type      = 'agency'
      AND o.agency_id = p_agency_id
      AND o.owner_id  = v_uid
  ) INTO v_authorized;

  -- Check 2 (fallback): org member with owner/booker role
  IF NOT v_authorized THEN
    SELECT EXISTS (
      SELECT 1
      FROM organizations        o
      JOIN organization_members om ON om.organization_id = o.id
      WHERE o.type      = 'agency'
        AND o.agency_id = p_agency_id
        AND om.user_id  = v_uid
        AND om.role     IN ('owner', 'booker')
    ) INTO v_authorized;
  END IF;

  -- Check 3 (legacy fallback): profile email matches agency email
  IF NOT v_authorized THEN
    SELECT EXISTS (
      SELECT 1
      FROM agencies  a
      JOIN profiles  pr ON pr.id = v_uid
      WHERE a.id = p_agency_id
        AND LOWER(TRIM(pr.email)) = LOWER(TRIM(a.email))
    ) INTO v_authorized;
  END IF;

  IF NOT v_authorized THEN
    RAISE EXCEPTION 'Not authorized to manage territories for agency %', p_agency_id;
  END IF;

  -- INSERT only — existing territories are kept intact (no DELETE).
  -- If a country already exists for this model (possibly via another agency),
  -- we claim it for this agency via DO UPDATE.
  IF p_country_codes IS NOT NULL THEN
    FOREACH v_code IN ARRAY p_country_codes LOOP
      v_code := UPPER(TRIM(v_code));
      CONTINUE WHEN v_code = '';
      INSERT INTO model_agency_territories (model_id, agency_id, country_code, territory)
      VALUES (p_model_id, p_agency_id, v_code, v_code)
      ON CONFLICT ON CONSTRAINT model_agency_territories_unique_model_country
      DO UPDATE SET agency_id = EXCLUDED.agency_id,
                    territory  = EXCLUDED.territory;
    END LOOP;
  END IF;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_model_territories(UUID, UUID, TEXT[]) TO authenticated;
