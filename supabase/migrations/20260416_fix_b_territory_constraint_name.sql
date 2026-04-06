-- =============================================================================
-- Fix B: Territory RPCs — Correct Constraint Name
--
-- PROBLEM:
--   Three functions reference ON CONFLICT ON CONSTRAINT
--   model_agency_territories_unique_model_country, which does NOT exist.
--   The constraint was renamed by 20260413_fix_a_territory_unique_constraint.sql
--   to model_agency_territories_one_agency_per_territory (UNIQUE on model_id,
--   country_code). As a result:
--     • save_model_territories       → 400 on every call (constraint not found)
--     • bulk_add_model_territories   → 400 on every call
--     • bulk_save_model_territories  → 400 on every call
--   This blocks all territory saves and therefore all "Add Model" flows.
--
-- FIX:
--   Recreate all three functions with the correct constraint name
--   model_agency_territories_one_agency_per_territory.
--   save_model_territories also gets the security upgrade from secdef_scope_guards
--   (org-membership guard instead of deprecated email-match fallback).
--
-- Idempotent: CREATE OR REPLACE.
-- =============================================================================

-- ─── 1. save_model_territories ───────────────────────────────────────────────
-- Single-model territory replace (called by upsertTerritoriesForModel in frontend).
-- Previous version: email-match fallback (GEFAHR 2) + wrong constraint name.
-- This version: org-membership guard only + correct constraint name.

CREATE OR REPLACE FUNCTION public.save_model_territories(
  p_model_id      uuid,
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
  v_uid      uuid := auth.uid();
  v_code     text;
  v_org_id   uuid;
BEGIN
  -- GUARD 1: Must be authenticated
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- GUARD 2: Caller must belong to the target agency org OR be admin.
  -- (email-match fallback removed — violates GEFAHR 2 / rls-security-patterns)
  IF NOT public.is_current_user_admin() THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.organization_members om
      JOIN public.organizations o ON o.id = om.organization_id
      WHERE om.user_id  = v_uid
        AND o.agency_id = p_agency_id
        AND o.type      = 'agency'
    ) AND NOT EXISTS (
      SELECT 1 FROM public.agencies
      WHERE id = p_agency_id AND owner_user_id = v_uid
    ) THEN
      RAISE EXCEPTION 'not_authorized';
    END IF;
  END IF;

  -- Resolve org_id for model_assignments dual-write (caller-verified above)
  -- LIMIT 1 is safe here: sub-resource lookup after verified agency guard
  SELECT id INTO v_org_id
  FROM public.organizations
  WHERE type      = 'agency'
    AND agency_id = p_agency_id
  ORDER BY created_at ASC
  LIMIT 1;

  -- Delete all existing territories for this model+agency
  DELETE FROM public.model_agency_territories t
  WHERE t.model_id  = p_model_id
    AND t.agency_id = p_agency_id;

  IF v_org_id IS NOT NULL THEN
    DELETE FROM public.model_assignments ma
    WHERE ma.model_id        = p_model_id
      AND ma.organization_id = v_org_id;
  END IF;

  -- Insert new territories (skip blanks, uppercase)
  IF p_country_codes IS NOT NULL THEN
    FOREACH v_code IN ARRAY p_country_codes LOOP
      v_code := upper(trim(v_code));
      CONTINUE WHEN v_code = '';

      INSERT INTO public.model_agency_territories (model_id, agency_id, country_code, territory)
      VALUES (p_model_id, p_agency_id, v_code, v_code)
      ON CONFLICT ON CONSTRAINT model_agency_territories_one_agency_per_territory
      DO UPDATE SET agency_id = EXCLUDED.agency_id,
                    territory  = EXCLUDED.territory;

      IF v_org_id IS NOT NULL THEN
        INSERT INTO public.model_assignments (model_id, organization_id, territory, role)
        VALUES (p_model_id, v_org_id, v_code, 'non_exclusive')
        ON CONFLICT ON CONSTRAINT model_assignments_unique_model_territory
        DO UPDATE SET organization_id = EXCLUDED.organization_id;
      END IF;
    END LOOP;
  END IF;

  RETURN TRUE;
END;
$$;

REVOKE ALL    ON FUNCTION public.save_model_territories(uuid, uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_model_territories(uuid, uuid, text[]) TO authenticated;

COMMENT ON FUNCTION public.save_model_territories IS
  'FIXED (20260416): correct constraint name model_agency_territories_one_agency_per_territory. '
  'Security: email-match fallback removed (GEFAHR 2); org-membership guard only. '
  'Dual-writes to model_agency_territories (legacy) and model_assignments.';


-- ─── 2. bulk_add_model_territories ───────────────────────────────────────────
-- Identical to secdef_scope_guards_final version but with correct constraint name.

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
  -- GUARD 1: Must be authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- GUARD 2: Caller must belong to the target agency org OR be admin.
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

  -- Resolve org_id for model_assignments dual-write
  -- LIMIT 1 safe: sub-resource lookup after verified agency guard
  SELECT id INTO v_org_id
  FROM public.organizations
  WHERE type      = 'agency'
    AND agency_id = p_agency_id
  ORDER BY created_at ASC
  LIMIT 1;

  -- Legacy dual-write: model_agency_territories (additive — no DELETE)
  INSERT INTO public.model_agency_territories (model_id, agency_id, country_code, territory)
  SELECT m.id, p_agency_id, c.code, c.code
  FROM unnest(p_model_ids)       AS m(id)
  CROSS JOIN unnest(v_normalized) AS c(code)
  ON CONFLICT ON CONSTRAINT model_agency_territories_one_agency_per_territory
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
  'FIXED (20260416): correct constraint name model_agency_territories_one_agency_per_territory. '
  'Adds territories for multiple models to the caller''s agency (additive). '
  'Dual-writes to model_agency_territories (legacy) and model_assignments.';


-- ─── 3. bulk_save_model_territories ──────────────────────────────────────────
-- Identical to secdef_scope_guards_final version but with correct constraint name.

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
  -- GUARD 1: Must be authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- GUARD 2: Caller must belong to the target agency org OR be admin.
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
  -- LIMIT 1 safe: sub-resource lookup after verified agency guard
  SELECT id INTO v_org_id
  FROM public.organizations
  WHERE type      = 'agency'
    AND agency_id = p_agency_id
  ORDER BY created_at ASC
  LIMIT 1;

  -- Delete existing territories for these models+agency (replace semantics)
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
    ON CONFLICT ON CONSTRAINT model_agency_territories_one_agency_per_territory
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
  'FIXED (20260416): correct constraint name model_agency_territories_one_agency_per_territory. '
  'Replaces all territories for multiple models for the caller''s agency. '
  'Dual-writes to model_agency_territories (legacy) and model_assignments.';


-- ─── Verification ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'save_model_territories'
  ), 'FAIL: save_model_territories missing';

  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'bulk_add_model_territories'
  ), 'FAIL: bulk_add_model_territories missing';

  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'bulk_save_model_territories'
  ), 'FAIL: bulk_save_model_territories missing';

  -- Ensure no function still references the old (non-existent) constraint name
  ASSERT NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('save_model_territories', 'bulk_add_model_territories', 'bulk_save_model_territories')
      AND pg_get_functiondef(p.oid) ILIKE '%model_agency_territories_unique_model_country%'
  ), 'FAIL: at least one territory function still references the old constraint name';

  -- Correct constraint exists
  ASSERT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'model_agency_territories_one_agency_per_territory'
      AND conrelid = 'public.model_agency_territories'::regclass
  ), 'FAIL: constraint model_agency_territories_one_agency_per_territory not found';
END $$;
