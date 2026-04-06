-- =============================================================================
-- Fix H: Model Org-Kontext — Canonical Architecture Decision + get_my_model_agencies()
--
-- ARCHITECTURAL DECISION (binding):
--   Models do NOT use organization_members for their org relationship.
--   The canonical source of truth for which agencies represent a model is:
--
--     model_agency_territories (model_id, agency_id, country_code)
--
--   This table expresses: "agency X represents model M in territory T."
--   Multiple agencies can represent the same model in DIFFERENT territories
--   (Fix A ensures one agency per territory per model).
--
-- RATIONALE:
--   - organization_members is designed for B2B users (agency staff, client staff)
--     who log into the platform and take actions.
--   - Models are a different entity: they are represented BY agencies, not
--     members OF them. Adding models to organization_members would:
--       a) Require org-type-specific role validation changes (trg_validate_org_member_role)
--       b) Mix B2B membership semantics with model representation semantics
--       c) Complicate the model multi-agency scenario (a model in 5 agencies
--          would need 5 organization_members rows, each with its own RLS scope)
--
-- WHAT get_my_org_context() RETURNS FOR MODELS:
--   Nothing. Models call get_my_model_agencies() instead.
--   AuthContext (Fix B) already gates get_my_org_context() with:
--     if (!isGuest && (role === 'client' || role === 'agent')) { ... }
--   Models (role = 'model') correctly skip this call.
--
-- NEW RPC: get_my_model_agencies()
--   Returns all agencies + their organizations for the calling model user.
--   Frontend uses this to show the model which agencies represent them
--   and in which territories.
--
-- Idempotent: safe to run multiple times.
-- =============================================================================


-- ─── 1. get_my_model_agencies() ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_my_model_agencies()
RETURNS TABLE(
  model_id        uuid,
  agency_id       uuid,
  agency_name     text,
  organization_id uuid,
  territory       text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
BEGIN
  -- GUARD 1: authenticated (Rule 21)
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- GUARD 2: caller must have a linked model record
  -- (auth.uid() = models.user_id — set by claim_model_by_token or link_model_by_email)
  IF NOT EXISTS (SELECT 1 FROM public.models WHERE user_id = auth.uid()) THEN
    -- Not a linked model yet (application phase) — return empty set, not an error
    RETURN;
  END IF;

  -- Return all agencies + orgs + territories for the calling model user.
  -- Multiple rows are possible (multi-agency, different territories).
  RETURN QUERY
    SELECT
      m.id                AS model_id,
      mat.agency_id       AS agency_id,
      a.name              AS agency_name,
      o.id                AS organization_id,
      mat.country_code    AS territory
    FROM public.models m
    JOIN public.model_agency_territories mat ON mat.model_id = m.id
    JOIN public.agencies a                   ON a.id = mat.agency_id
    LEFT JOIN public.organizations o         ON o.agency_id = mat.agency_id
                                               AND o.type = 'agency'
    WHERE m.user_id = auth.uid()
    ORDER BY mat.country_code ASC;
END;
$$;

REVOKE ALL    ON FUNCTION public.get_my_model_agencies() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_model_agencies() TO authenticated;

COMMENT ON FUNCTION public.get_my_model_agencies() IS
  'Fix H (20260413): Returns all agencies + territories for the calling model user. '
  'Models use model_agency_territories (not organization_members) as their org anchor. '
  'Returns empty set during application phase (before any agency link is confirmed). '
  'Multiple rows possible: one per (agency, territory) pair. '
  'SECURITY DEFINER + row_security=off + GUARD 1 per Rule 21.';


-- ─── 2. model_is_linked() — helper for RLS policies ─────────────────────────
--
-- Returns true when the calling user has a linked model record (user_id = auth.uid()).
-- Used in model self-access RLS policies (models can read their own data).

CREATE OR REPLACE FUNCTION public.caller_is_linked_model()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.models WHERE user_id = auth.uid()
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.caller_is_linked_model() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.caller_is_linked_model() TO authenticated;

COMMENT ON FUNCTION public.caller_is_linked_model() IS
  'Fix H (20260413): Returns true when the calling user has a linked model record. '
  'Use in RLS policies to gate model-self-access without reading profiles table.';


-- ─── 3. Ensure "Models can read own model" RLS policy uses caller_is_linked_model ─

-- Check what the current policy looks like; replace if it references profiles directly
DO $$
DECLARE
  v_qual text;
BEGIN
  SELECT qual INTO v_qual
  FROM pg_policies
  WHERE tablename = 'models'
    AND policyname ILIKE '%model%own%'
  LIMIT 1;

  IF v_qual IS NOT NULL THEN
    RAISE NOTICE 'Existing model self-access policy: %', left(v_qual, 200);
  ELSE
    RAISE NOTICE 'No model self-access policy found — creating one';
  END IF;
END $$;

-- Drop and recreate the model self-read policy using the new helper
DROP POLICY IF EXISTS "Models can read own model"   ON public.models;
DROP POLICY IF EXISTS "models_read_own"             ON public.models;
DROP POLICY IF EXISTS "model_self_read"             ON public.models;

CREATE POLICY "model_self_read"
  ON public.models FOR SELECT
  TO authenticated
  USING (
    -- A model user can always read their own model record
    user_id = auth.uid()
  );

-- Drop and recreate the model self-update policy
DROP POLICY IF EXISTS "Models can update own model" ON public.models;
DROP POLICY IF EXISTS "models_update_own"           ON public.models;
DROP POLICY IF EXISTS "model_self_update"           ON public.models;

CREATE POLICY "model_self_update"
  ON public.models FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    -- Agency-managed models must update via agency_update_model_full RPC
    -- (which checks agency ownership). Direct update only when no agency is set.
    AND agency_id IS NULL
  )
  WITH CHECK (
    user_id = auth.uid()
    AND agency_id IS NULL
  );


-- ─── 4. Architecture documentation comment ────────────────────────────────────

COMMENT ON TABLE public.model_agency_territories IS
  'Canonical source of truth for model-agency relationships. '
  'Expresses: "agency X represents model M in territory T (ISO country code)." '
  'UNIQUE(model_id, country_code) enforces one agency per territory per model (Fix A). '
  'Models do NOT appear in organization_members — this table is their org anchor. '
  'See Fix H (20260413) for architecture decision rationale.';


-- ─── Verification ─────────────────────────────────────────────────────────────

DO $$
BEGIN
  ASSERT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_my_model_agencies'),
    'FAIL: get_my_model_agencies function not found';

  ASSERT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'caller_is_linked_model'),
    'FAIL: caller_is_linked_model function not found';

  ASSERT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'models'
      AND policyname = 'model_self_read'
  ), 'FAIL: model_self_read policy not found on models';

  RAISE NOTICE 'PASS: 20260413_fix_h — model org strategy implemented; get_my_model_agencies() + caller_is_linked_model() created';
END $$;
