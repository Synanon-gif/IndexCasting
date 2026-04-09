-- =============================================================================
-- FIX: Drop ambiguous ensure_client_organization() overload (2026-05-20)
--
-- Root cause: Two overloads exist on the live DB:
--   1. ensure_client_organization()                              — OID 29139 (legacy, 0 params)
--   2. ensure_client_organization(p_company_name text DEFAULT NULL) — OID 43774 (migration 20260409)
--
-- When bootstrap calls PERFORM public.ensure_client_organization(), PostgreSQL
-- error 42725: "function is not unique" — cannot choose between the two.
--
-- Fix: Drop the legacy 0-param overload. The 1-param version with DEFAULT NULL
-- covers both call patterns: ensure_client_organization() and
-- ensure_client_organization('Company Name').
--
-- Also drop the legacy ensure_agency_for_current_agent() 0-param overload
-- if it exists (same pattern from migration 20260409).
-- =============================================================================

-- Drop the legacy 0-param overload (exact signature match)
DROP FUNCTION IF EXISTS public.ensure_client_organization();

-- Recreate the canonical version to make sure it's correct
CREATE OR REPLACE FUNCTION public.ensure_client_organization(
  p_company_name text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  oid   uuid;
  oname text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF (SELECT role FROM public.profiles WHERE id = auth.uid()) IS DISTINCT FROM 'client' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT o.id INTO oid
  FROM   public.organizations o
  WHERE  o.owner_id = auth.uid() AND o.type = 'client'
  LIMIT  1;
  IF oid IS NOT NULL THEN
    RETURN oid;
  END IF;

  SELECT COALESCE(
    NULLIF(trim(p_company_name), ''),
    NULLIF(trim(company_name), ''),
    'My Organization'
  ) INTO oname
  FROM public.profiles
  WHERE id = auth.uid();

  INSERT INTO public.organizations (name, type, owner_id, agency_id)
  VALUES (oname, 'client', auth.uid(), NULL)
  RETURNING id INTO oid;

  INSERT INTO public.organization_members (user_id, organization_id, role)
  VALUES (auth.uid(), oid, 'owner');

  RETURN oid;
END;
$function$;

-- Same fix for ensure_agency_for_current_agent if ambiguous
DO $$
DECLARE
  cnt int;
BEGIN
  SELECT count(*) INTO cnt
  FROM pg_proc
  WHERE proname = 'ensure_agency_for_current_agent'
    AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
  IF cnt > 1 THEN
    -- Drop the legacy 0-param overload
    DROP FUNCTION IF EXISTS public.ensure_agency_for_current_agent();
    RAISE NOTICE 'Dropped ambiguous ensure_agency_for_current_agent() overload';
  END IF;
END $$;


-- ─── VERIFICATION ────────────────────────────────────────────────────────────

DO $$
DECLARE
  cnt int;
BEGIN
  SELECT count(*) INTO cnt
  FROM pg_proc
  WHERE proname = 'ensure_client_organization'
    AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
  ASSERT cnt = 1,
    'FAIL: expected exactly 1 ensure_client_organization overload, found ' || cnt;

  RAISE NOTICE 'PASS: ensure_client_organization has exactly 1 overload';
END $$;
