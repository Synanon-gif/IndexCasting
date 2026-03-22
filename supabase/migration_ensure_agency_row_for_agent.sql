-- Self-service agency: create public.agencies row for the signed-in agent when none exists
-- for their profile email. RLS blocks direct INSERT for authenticated — this RPC runs as SECURITY DEFINER.
-- Run after migration_agencies_code.sql (column `code` UNIQUE).
--
-- Name/email come from profiles (company_name from sign-up, else display_name, else "Agency").

CREATE OR REPLACE FUNCTION public.ensure_agency_for_current_agent()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  aid uuid;
  pem text;
  ag_name text;
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
    COALESCE(NULLIF(trim(p.company_name), ''), NULLIF(trim(p.display_name), ''), 'Agency')
  INTO pem, ag_name
  FROM public.profiles p
  WHERE p.id = auth.uid();

  IF pem IS NULL OR pem = '' THEN
    RAISE EXCEPTION 'profile email required';
  END IF;

  SELECT a.id INTO aid
  FROM public.agencies a
  WHERE lower(trim(a.email)) = lower(trim(pem))
  LIMIT 1;
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

REVOKE ALL ON FUNCTION public.ensure_agency_for_current_agent() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_agency_for_current_agent() TO authenticated;

COMMENT ON FUNCTION public.ensure_agency_for_current_agent() IS
  'Creates a agencies row for the current agent profile email if missing (owner bootstrap). Then ensure_agency_organization can create organizations.';
