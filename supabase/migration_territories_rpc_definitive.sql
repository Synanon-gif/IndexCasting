-- =============================================================================
-- DEFINITIVE FIX: Territory management via SECURITY DEFINER RPCs
--
-- Root cause of all previous failures:
--   1) RLS: profiles SELECT policy = "auth.uid() = id" → email-JOIN in RLS
--      policy could never work (other profiles unreadable)
--   2) RETURNS TABLE(model_id, ...) creates PL/pgSQL OUT-vars with same names
--      as table columns → "column reference 'model_id' is ambiguous"
--
-- Fix: SECURITY DEFINER functions + RETURNS BOOLEAN (not RETURNS TABLE)
--      to avoid ALL ambiguity. TypeScript re-fetches rows after save.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0a) Fix legacy 'territory' column: TEXT NOT NULL from migration_phase2_datamodel.sql
--     New code only writes country_code; territory must accept NULL or have a default.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'model_agency_territories'
      AND column_name  = 'territory'
  ) THEN
    -- Drop NOT NULL so INSERTs that omit territory still work
    ALTER TABLE public.model_agency_territories
      ALTER COLUMN territory DROP NOT NULL;
    -- Set default to empty string for backward compat with old code paths
    ALTER TABLE public.model_agency_territories
      ALTER COLUMN territory SET DEFAULT '';
  END IF;
END $$;

-- Drop the legacy UNIQUE(model_id, territory) constraint if it still exists
DO $$
DECLARE v_con text;
BEGIN
  SELECT con.conname INTO v_con
  FROM pg_constraint con
  WHERE con.conrelid = 'public.model_agency_territories'::regclass
    AND con.contype  = 'u'
    AND array_to_string(
          ARRAY(SELECT attname FROM pg_attribute
                WHERE attrelid = con.conrelid
                  AND attnum   = ANY(con.conkey)
                ORDER BY attnum),
          ','
        ) = 'model_id,territory';
  IF v_con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.model_agency_territories DROP CONSTRAINT %I', v_con);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 0b) Ensure UNIQUE(model_id, country_code) — idempotent
-- ---------------------------------------------------------------------------
ALTER TABLE public.model_agency_territories
  DROP CONSTRAINT IF EXISTS model_agency_territories_unique_model_country_agency;

ALTER TABLE public.model_agency_territories
  DROP CONSTRAINT IF EXISTS model_agency_territories_unique_model_country;

ALTER TABLE public.model_agency_territories
  ADD CONSTRAINT model_agency_territories_unique_model_country
  UNIQUE (model_id, country_code);

-- ---------------------------------------------------------------------------
-- 1) Permissive RLS: any authenticated user can read and write.
--    Authorization is enforced inside the SECURITY DEFINER RPCs below.
-- ---------------------------------------------------------------------------
ALTER TABLE public.model_agency_territories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Agencies can manage their territories"     ON public.model_agency_territories;
DROP POLICY IF EXISTS "Agencies can manage their territories v2"  ON public.model_agency_territories;
DROP POLICY IF EXISTS "Agencies can view their territories"       ON public.model_agency_territories;
DROP POLICY IF EXISTS "Clients can view model territories"        ON public.model_agency_territories;
DROP POLICY IF EXISTS "Authenticated users can read territories"  ON public.model_agency_territories;
DROP POLICY IF EXISTS "Authenticated users can write territories" ON public.model_agency_territories;

CREATE POLICY "Authenticated users can read territories"
  ON public.model_agency_territories
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can write territories"
  ON public.model_agency_territories
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 2) save_model_territories — SECURITY DEFINER, RETURNS BOOLEAN
--    (no RETURNS TABLE → avoids column-name ambiguity with OUT vars)
--    Deletes all territories for (model, agency) then inserts new list.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.save_model_territories(UUID, UUID, TEXT[]);

CREATE OR REPLACE FUNCTION public.save_model_territories(
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

  -- Check 1: direct org owner_id match (fastest, no email comparison needed)
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

  -- Delete all current rows for this model+agency
  DELETE FROM model_agency_territories t
  WHERE t.model_id  = p_model_id
    AND t.agency_id = p_agency_id;

  -- Insert new country codes (skip blanks, uppercase).
  -- Also write `territory` = country_code for backward compat with legacy NOT NULL column.
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

GRANT EXECUTE ON FUNCTION public.save_model_territories(UUID, UUID, TEXT[]) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) get_territories_for_agency_roster — returns (model_id, country_code) rows
--    for every model that belongs to an agency.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_territories_for_agency_roster(UUID);

CREATE OR REPLACE FUNCTION public.get_territories_for_agency_roster(
  p_agency_id UUID
)
RETURNS TABLE(
  r_model_id     UUID,
  r_country_code TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.model_id, t.country_code
  FROM   model_agency_territories t
  WHERE  t.agency_id = p_agency_id
  ORDER  BY t.country_code;
$$;

GRANT EXECUTE ON FUNCTION public.get_territories_for_agency_roster(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) get_territories_for_model — returns territory rows for one model
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_territories_for_model(UUID, UUID);

CREATE OR REPLACE FUNCTION public.get_territories_for_model(
  p_model_id  UUID,
  p_agency_id UUID DEFAULT NULL
)
RETURNS TABLE(
  r_id           UUID,
  r_model_id     UUID,
  r_agency_id    UUID,
  r_country_code TEXT,
  r_created_at   TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.id, t.model_id, t.agency_id, t.country_code, t.created_at
  FROM   model_agency_territories t
  WHERE  t.model_id = p_model_id
    AND  (p_agency_id IS NULL OR t.agency_id = p_agency_id)
  ORDER  BY t.country_code;
$$;

GRANT EXECUTE ON FUNCTION public.get_territories_for_model(UUID, UUID) TO authenticated;
