-- =============================================================================
-- ensure_client_organization / ensure_agency_for_current_agent:
-- accept explicit p_company_name parameter
-- 2026-04-09
--
-- Problem: both RPCs resolved the organization/agency name by reading
-- profiles.company_name at call time.  If the profiles row had not yet been
-- updated with company_name (trigger bug fixed in 20260409_handle_new_user_
-- company_name.sql, or transient upsert failure), the fallback 'My Organization'
-- / 'Agency' was used.
--
-- Fix: add an optional p_company_name TEXT parameter (DEFAULT NULL).
-- Name resolution order:
--   1. p_company_name   (explicit, passed by the frontend)
--   2. profiles.company_name   (set by the trigger as of today's fix)
--   3. hard fallback   ('My Organization' / 'Agency')
--
-- All existing callers that pass no argument continue to work unchanged
-- (DEFAULT NULL falls through to profiles.company_name).
-- =============================================================================

-- ─── 1. ensure_client_organization ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ensure_client_organization(
  p_company_name text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Return existing org if one already exists for this owner.
  SELECT o.id INTO oid
  FROM   public.organizations o
  WHERE  o.owner_id = auth.uid() AND o.type = 'client'
  LIMIT  1;
  IF oid IS NOT NULL THEN
    RETURN oid;
  END IF;

  -- Name resolution: explicit param > profiles.company_name > fallback.
  -- Only use company_name; never fall back to personal display_name.
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
$$;

REVOKE ALL    ON FUNCTION public.ensure_client_organization(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_client_organization(text) TO authenticated;

COMMENT ON FUNCTION public.ensure_client_organization(text) IS
  'Creates a client organization for the current user if none exists. '
  'Name: p_company_name > profiles.company_name > ''My Organization''.';

-- ─── 2. ensure_agency_for_current_agent ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ensure_agency_for_current_agent(
  p_company_name text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  aid      uuid;
  pem      text;
  ag_name  text;
  new_code text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF (SELECT p.role::text FROM public.profiles p WHERE p.id = auth.uid()) IS DISTINCT FROM 'agent' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT
    trim(COALESCE(p.email, '')),
    -- Name resolution: explicit param > profiles.company_name > fallback.
    -- Never fall back to personal display_name.
    COALESCE(
      NULLIF(trim(p_company_name), ''),
      NULLIF(trim(p.company_name), ''),
      'Agency'
    )
  INTO pem, ag_name
  FROM public.profiles p
  WHERE p.id = auth.uid();

  IF pem IS NULL OR pem = '' THEN
    RAISE EXCEPTION 'profile email required';
  END IF;

  -- Return existing agency if one already exists for this email.
  SELECT a.id INTO aid
  FROM   public.agencies a
  WHERE  lower(trim(a.email)) = lower(trim(pem))
  LIMIT  1;
  IF aid IS NOT NULL THEN
    RETURN aid;
  END IF;

  new_code := 'a' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 15);

  INSERT INTO public.agencies (name, email, code)
  VALUES (ag_name, pem, new_code)
  RETURNING id INTO aid;

  RETURN aid;
END;
$$;

REVOKE ALL    ON FUNCTION public.ensure_agency_for_current_agent(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_agency_for_current_agent(text) TO authenticated;

COMMENT ON FUNCTION public.ensure_agency_for_current_agent(text) IS
  'Creates an agencies row for the current agent profile email if missing. '
  'Name: p_company_name > profiles.company_name > ''Agency''. Never falls back to display_name.';
