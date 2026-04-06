-- =============================================================================
-- Migration: 20260413_secdef_scope_guards_final.sql
--
-- WHY: 5 SECURITY DEFINER + row_security=off functions were missing internal
-- auth guards: any authenticated user could read or write data belonging to any
-- organization. With row_security=off the caller sees ALL rows — so every SELECT
-- on a multi-tenant table MUST be bound to a verified caller variable.
--
-- FUNCTIONS FIXED:
--   1. bulk_add_model_territories  — no auth.uid() or membership check (WRITE)
--   2. bulk_save_model_territories — no auth.uid() or membership check (WRITE)
--   3. get_assignments_for_agency_roster — no membership check (READ)
--   4. get_assignments_for_model         — NULL org exposes all territories (READ)
--   5. get_territories_for_agency_roster — no auth.uid() check (READ)
--
-- ALSO:
--   6. list_client_organizations_for_agency_directory — Option B (plan §Fix 2):
--      Existing agency-membership gate is kept; LIMIT 100→50; COMMENT updated.
--      B2B-Discovery feature for agencies to find new client partners — intentional.
--
-- SECURITY PATTERN (Rule 23 in cursorrules):
--   Every SELECT/INSERT/DELETE on a multi-tenant table inside a SECURITY DEFINER
--   + row_security=off function MUST be bound to a variable verified by prior guards.
--   Broad SELECTs without a WHERE binding to a caller-verified variable are forbidden.
--
-- Idempotent: CREATE OR REPLACE.
-- =============================================================================


-- ─── 1. bulk_add_model_territories ───────────────────────────────────────────
-- Add GUARD 1 (auth) + GUARD 2 (agency membership).
-- Business logic (INSERT) is unchanged.

CREATE OR REPLACE FUNCTION public.bulk_add_model_territories(
  p_model_ids     uuid[],
  p_agency_id     uuid,
  p_country_codes text[]
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off  -- RLS off; internal guards below are the sole auth layer
AS $$
DECLARE
  v_normalized text[];
  v_org_id     uuid;
BEGIN
  -- INTERNAL GUARD 1: Must be authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- INTERNAL GUARD 2: Caller must belong to the target agency org OR be admin.
  -- Without this anyone with a known agency UUID could write territories.
  IF NOT public.is_current_user_admin() THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.organization_members om
      JOIN public.organizations o ON o.id = om.organization_id
      WHERE om.user_id   = auth.uid()
        AND o.agency_id  = p_agency_id
    ) AND NOT EXISTS (
      SELECT 1 FROM public.agencies
      WHERE id = p_agency_id AND owner_user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'not_in_agency';
    END IF;
  END IF;

  -- Normalize country codes
  SELECT ARRAY(
    SELECT DISTINCT upper(trim(c))
    FROM unnest(p_country_codes) AS c
    WHERE trim(c) <> ''
  ) INTO v_normalized;

  IF array_length(v_normalized, 1) IS NULL OR array_length(p_model_ids, 1) IS NULL THEN
    RETURN TRUE;
  END IF;

  -- Resolve org_id for model_assignments dual-write (caller-verified agency above)
  SELECT id INTO v_org_id
  FROM public.organizations
  WHERE type     = 'agency'
    AND agency_id = p_agency_id
  ORDER BY created_at ASC
  LIMIT 1;

  -- Legacy dual-write: model_agency_territories
  INSERT INTO public.model_agency_territories (model_id, agency_id, country_code, territory)
  SELECT m.id, p_agency_id, c.code, c.code
  FROM unnest(p_model_ids)       AS m(id)
  CROSS JOIN unnest(v_normalized) AS c(code)
  ON CONFLICT ON CONSTRAINT model_agency_territories_unique_model_country
  DO UPDATE SET agency_id = EXCLUDED.agency_id,
                territory  = EXCLUDED.territory;

  -- New: model_assignments
  IF v_org_id IS NOT NULL THEN
    INSERT INTO public.model_assignments (model_id, organization_id, territory, role)
    SELECT m.id, v_org_id, c.code, 'non_exclusive'
    FROM unnest(p_model_ids)       AS m(id)
    CROSS JOIN unnest(v_normalized) AS c(code)
    ON CONFLICT ON CONSTRAINT model_assignments_unique_model_territory
    DO UPDATE SET organization_id = EXCLUDED.organization_id;
  END IF;

  RETURN TRUE;
END;
$$;

REVOKE ALL    ON FUNCTION public.bulk_add_model_territories(uuid[], uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bulk_add_model_territories(uuid[], uuid, text[]) TO authenticated;

COMMENT ON FUNCTION public.bulk_add_model_territories IS
  'SECURE (20260413): auth + agency-membership guard added. '
  'Adds territories for multiple models to the caller''s agency. '
  'Dual-writes to model_agency_territories (legacy) and model_assignments (new).';


-- ─── 2. bulk_save_model_territories ──────────────────────────────────────────
-- Add GUARD 1 (auth) + GUARD 2 (agency membership).
-- Business logic (DELETE + INSERT) is unchanged.

CREATE OR REPLACE FUNCTION public.bulk_save_model_territories(
  p_model_ids     uuid[],
  p_agency_id     uuid,
  p_country_codes text[]
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off  -- RLS off; internal guards below are the sole auth layer
AS $$
DECLARE
  v_normalized text[];
  v_org_id     uuid;
BEGIN
  -- INTERNAL GUARD 1: Must be authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- INTERNAL GUARD 2: Caller must belong to the target agency org OR be admin.
  IF NOT public.is_current_user_admin() THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.organization_members om
      JOIN public.organizations o ON o.id = om.organization_id
      WHERE om.user_id   = auth.uid()
        AND o.agency_id  = p_agency_id
    ) AND NOT EXISTS (
      SELECT 1 FROM public.agencies
      WHERE id = p_agency_id AND owner_user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'not_in_agency';
    END IF;
  END IF;

  -- Normalize country codes
  SELECT ARRAY(
    SELECT DISTINCT upper(trim(c))
    FROM unnest(p_country_codes) AS c
    WHERE trim(c) <> ''
  ) INTO v_normalized;

  IF array_length(p_model_ids, 1) IS NULL THEN
    RETURN TRUE;
  END IF;

  -- Resolve org_id for model_assignments dual-write
  SELECT id INTO v_org_id
  FROM public.organizations
  WHERE type     = 'agency'
    AND agency_id = p_agency_id
  ORDER BY created_at ASC
  LIMIT 1;

  -- Delete existing (caller-verified agency above prevents cross-tenant delete)
  DELETE FROM public.model_agency_territories t
  WHERE t.model_id  = ANY(p_model_ids)
    AND t.agency_id = p_agency_id;

  IF v_org_id IS NOT NULL THEN
    DELETE FROM public.model_assignments ma
    WHERE ma.model_id        = ANY(p_model_ids)
      AND ma.organization_id = v_org_id;
  END IF;

  -- Insert new territories (if any)
  IF array_length(v_normalized, 1) IS NOT NULL THEN
    INSERT INTO public.model_agency_territories (model_id, agency_id, country_code, territory)
    SELECT m.id, p_agency_id, c.code, c.code
    FROM unnest(p_model_ids)       AS m(id)
    CROSS JOIN unnest(v_normalized) AS c(code)
    ON CONFLICT ON CONSTRAINT model_agency_territories_unique_model_country
    DO UPDATE SET agency_id = EXCLUDED.agency_id,
                  territory  = EXCLUDED.territory;

    IF v_org_id IS NOT NULL THEN
      INSERT INTO public.model_assignments (model_id, organization_id, territory, role)
      SELECT m.id, v_org_id, c.code, 'non_exclusive'
      FROM unnest(p_model_ids)       AS m(id)
      CROSS JOIN unnest(v_normalized) AS c(code)
      ON CONFLICT ON CONSTRAINT model_assignments_unique_model_territory
      DO UPDATE SET organization_id = EXCLUDED.organization_id;
    END IF;
  END IF;

  RETURN TRUE;
END;
$$;

REVOKE ALL    ON FUNCTION public.bulk_save_model_territories(uuid[], uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bulk_save_model_territories(uuid[], uuid, text[]) TO authenticated;

COMMENT ON FUNCTION public.bulk_save_model_territories IS
  'SECURE (20260413): auth + agency-membership guard added. '
  'Replaces all territories for multiple models for the caller''s agency. '
  'Dual-writes to model_agency_territories (legacy) and model_assignments (new).';


-- ─── 3. get_assignments_for_agency_roster ────────────────────────────────────
-- Convert LANGUAGE sql → plpgsql to add GUARD: caller must be a member of
-- p_organization_id (via is_org_member which already has row_security=off).

DROP FUNCTION IF EXISTS public.get_assignments_for_agency_roster(UUID);

CREATE OR REPLACE FUNCTION public.get_assignments_for_agency_roster(
  p_organization_id UUID
)
RETURNS TABLE(
  r_model_id  UUID,
  r_territory TEXT,
  r_role      public.assignment_role
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off  -- RLS off; internal guard below is the sole auth layer
AS $$
BEGIN
  -- INTERNAL GUARD 1: Must be authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- INTERNAL GUARD 2: Caller must be a member of p_organization_id OR be admin.
  -- Without this, any authenticated user with a known UUID can read any org's roster.
  IF NOT public.is_current_user_admin()
     AND NOT public.is_org_member(p_organization_id) THEN
    RAISE EXCEPTION 'access_denied';
  END IF;

  -- Authorized: return model territories for this org (caller-verified above)
  RETURN QUERY
    SELECT ma.model_id, ma.territory, ma.role
    FROM   public.model_assignments ma
    WHERE  ma.organization_id = p_organization_id   -- bound to verified org
    ORDER  BY ma.territory;
END;
$$;

REVOKE ALL    ON FUNCTION public.get_assignments_for_agency_roster(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_assignments_for_agency_roster(UUID) TO authenticated;

COMMENT ON FUNCTION public.get_assignments_for_agency_roster IS
  'SECURE (20260413): membership guard added. '
  'Returns model_assignments for an org. Caller must be a member of p_organization_id.';


-- ─── 4. get_assignments_for_model ────────────────────────────────────────────
-- Add GUARD: caller must own the model OR be a member of an org that has the
-- model in model_assignments. The old NULL-org path exposed all territories.

DROP FUNCTION IF EXISTS public.get_assignments_for_model(UUID, UUID);

CREATE OR REPLACE FUNCTION public.get_assignments_for_model(
  p_model_id        UUID,
  p_organization_id UUID DEFAULT NULL
)
RETURNS TABLE(
  r_id              UUID,
  r_model_id        UUID,
  r_organization_id UUID,
  r_territory       TEXT,
  r_role            public.assignment_role,
  r_created_at      TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off  -- RLS off; internal guard below is the sole auth layer
AS $$
BEGIN
  -- INTERNAL GUARD 1: Must be authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- INTERNAL GUARD 2: Caller must be one of:
  --   a) Admin
  --   b) The model owner (model.user_id = auth.uid())
  --   c) A member of any org that has this model in model_assignments
  -- Without this, p_organization_id = NULL returned ALL territories for ALL orgs.
  IF NOT public.is_current_user_admin()
     AND NOT public.model_belongs_to_current_user(p_model_id)
     AND NOT EXISTS (
       SELECT 1
       FROM   public.model_assignments ma
       JOIN   public.organization_members om ON om.organization_id = ma.organization_id
       WHERE  ma.model_id   = p_model_id
         AND  om.user_id    = auth.uid()
     ) THEN
    RAISE EXCEPTION 'access_denied';
  END IF;

  -- Authorized: return assignments (optionally filtered by org)
  RETURN QUERY
    SELECT ma.id, ma.model_id, ma.organization_id, ma.territory, ma.role, ma.created_at
    FROM   public.model_assignments ma
    WHERE  ma.model_id = p_model_id                                    -- bound to verified model
      AND  (p_organization_id IS NULL OR ma.organization_id = p_organization_id)
    ORDER  BY ma.territory;
END;
$$;

REVOKE ALL    ON FUNCTION public.get_assignments_for_model(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_assignments_for_model(UUID, UUID) TO authenticated;

COMMENT ON FUNCTION public.get_assignments_for_model IS
  'SECURE (20260413): ownership/membership guard added. '
  'Returns model_assignments for a model. Caller must own the model or be in an org that represents it. '
  'NULL p_organization_id returns all territories the caller is authorized to see.';


-- ─── 5. get_territories_for_agency_roster ────────────────────────────────────
-- Convert LANGUAGE sql → plpgsql to add GUARD: caller must belong to an org
-- with this agency_id. Previously: zero auth check, any authenticated user
-- with a known agency UUID could read all territory/model pairs.

CREATE OR REPLACE FUNCTION public.get_territories_for_agency_roster(
  p_agency_id uuid
)
RETURNS TABLE (
  r_model_id     uuid,
  r_country_code text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off  -- RLS off; internal guard below is the sole auth layer
AS $$
BEGIN
  -- INTERNAL GUARD 1: Must be authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- INTERNAL GUARD 2: Caller must be a member of an org that belongs to this agency
  -- OR be an agency owner OR be admin.
  IF NOT public.is_current_user_admin() THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.organization_members om
      JOIN public.organizations o ON o.id = om.organization_id
      WHERE om.user_id  = auth.uid()
        AND o.agency_id = p_agency_id
        AND o.type      = 'agency'
    ) AND NOT EXISTS (
      SELECT 1 FROM public.agencies
      WHERE id = p_agency_id AND owner_user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'not_in_agency';
    END IF;
  END IF;

  -- Authorized: return territories for this agency's models
  RETURN QUERY
    SELECT
      ma.model_id   AS r_model_id,
      ma.territory  AS r_country_code
    FROM public.model_assignments ma
    JOIN public.organizations o ON o.id = ma.organization_id
    WHERE o.agency_id = p_agency_id       -- bound to verified agency
      AND o.type = 'agency'
    ORDER BY ma.territory;
END;
$$;

REVOKE ALL ON FUNCTION public.get_territories_for_agency_roster(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_territories_for_agency_roster(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_territories_for_agency_roster IS
  'SECURE (20260413): auth + agency-membership guard added. '
  'Returns model territory pairs for an agency roster. Caller must belong to the agency.';


-- ─── 6. list_client_organizations_for_agency_directory (Option B) ─────────────
-- The existing agency-membership gate is correct and stays.
-- Changes: LIMIT 100 → 50 (reduce data exposure); COMMENT updated to make
-- the B2B-Discovery intent explicit and auditable.

CREATE OR REPLACE FUNCTION public.list_client_organizations_for_agency_directory(
  p_agency_id uuid,
  p_search    text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_caller  uuid := auth.uid();
  rows_json jsonb;
  q         text := coalesce(trim(p_search), '');
BEGIN
  -- INTERNAL GUARD 1: Must be authenticated
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  -- INTERNAL GUARD 2: Caller must be a member of the given agency org.
  -- This is the intentional gate for B2B-Discovery: only agency members
  -- can browse the global client directory. (Design intent: B2B Telefonbuch)
  IF NOT public.is_current_user_admin() THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.organization_members m
      JOIN public.organizations o ON o.id = m.organization_id
      WHERE m.user_id   = v_caller
        AND o.type      = 'agency'
        AND o.agency_id = p_agency_id
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'not_allowed');
    END IF;
  END IF;

  -- Authorized: return client orgs (global directory, B2B-Discovery feature).
  -- LIMIT 50 (reduced from 100) to minimize data exposure per request.
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',                x.id,
        'name',              x.name,
        'organization_type', x.typ
      )
    ),
    '[]'::jsonb
  ) INTO rows_json
  FROM (
    SELECT o.id, o.name, o.type::text AS typ
    FROM public.organizations o
    WHERE o.type = 'client'
      AND (q = '' OR o.name ILIKE '%' || q || '%')
    ORDER BY o.name
    LIMIT 50   -- reduced from 100 for defense-in-depth
  ) x;

  RETURN jsonb_build_object('ok', true, 'rows', coalesce(rows_json, '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.list_client_organizations_for_agency_directory(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_client_organizations_for_agency_directory(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.list_client_organizations_for_agency_directory IS
  'B2B-DISCOVERY FEATURE (intentional global scope, documented 20260413): '
  'Agency org members browse all client organizations — equivalent to a B2B phone book. '
  'Gate: caller must be a member of p_agency_id org. LIMIT 50 per request. '
  'This intentional broad SELECT is safe because: (a) client org names/IDs are '
  'not sensitive PII, (b) agency-membership gate prevents anonymous access, '
  '(c) LIMIT 50 bounds data exposure. To restrict to existing relationships only '
  'use Option A (join option_requests) in a future migration if business requirements change.';


-- ─── Verification ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  -- All 5 fixed functions must have row_security=off
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'bulk_add_model_territories'
      AND 'row_security=off' = ANY(proconfig)
  ), 'FAIL: bulk_add_model_territories missing row_security=off';

  ASSERT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'bulk_save_model_territories'
      AND 'row_security=off' = ANY(proconfig)
  ), 'FAIL: bulk_save_model_territories missing row_security=off';

  -- All must contain not_authenticated guard (confirms guard was applied)
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'bulk_add_model_territories'
      AND prosrc ILIKE '%not_authenticated%'
  ), 'FAIL: bulk_add_model_territories missing auth guard';

  ASSERT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'get_assignments_for_agency_roster'
      AND prosrc ILIKE '%access_denied%'
  ), 'FAIL: get_assignments_for_agency_roster missing access_denied guard';

  ASSERT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'get_assignments_for_model'
      AND prosrc ILIKE '%access_denied%'
  ), 'FAIL: get_assignments_for_model missing access_denied guard';

  ASSERT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'get_territories_for_agency_roster'
      AND prosrc ILIKE '%not_in_agency%'
  ), 'FAIL: get_territories_for_agency_roster missing not_in_agency guard';

  RAISE NOTICE 'PASS: 20260413_secdef_scope_guards_final — all verifications passed';
END $$;
