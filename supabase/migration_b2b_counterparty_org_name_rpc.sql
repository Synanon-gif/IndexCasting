-- B2B chat titles: resolve the OTHER party's display name even when RLS blocks direct
-- SELECT on public.organizations (members only see their own org row).
-- Run in Supabase SQL Editor after migration_organizations_invitations_rls.sql and B2B conversation columns exist.

-- ---------------------------------------------------------------------------
-- RPC: name of the B2B counterparty org for the current user (viewer org member)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_b2b_counterparty_org_name(
  p_viewer_org_id uuid,
  p_client_org_id uuid,
  p_agency_org_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_other uuid;
  v_name text;
BEGIN
  IF v_caller IS NULL THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.organization_members m
    WHERE m.user_id = v_caller
      AND m.organization_id = p_viewer_org_id
  ) THEN
    RETURN NULL;
  END IF;

  IF p_viewer_org_id = p_client_org_id THEN
    v_other := p_agency_org_id;
  ELSIF p_viewer_org_id = p_agency_org_id THEN
    v_other := p_client_org_id;
  ELSE
    RETURN NULL;
  END IF;

  IF v_other IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT
    COALESCE(
      NULLIF(trim(o.name), ''),
      CASE
        WHEN o.type = 'agency' AND o.agency_id IS NOT NULL THEN (
          SELECT NULLIF(trim(a.name), '')
          FROM public.agencies a
          WHERE a.id = o.agency_id
          LIMIT 1
        )
        ELSE NULL
      END,
      CASE
        WHEN o.type = 'client' AND o.owner_id IS NOT NULL THEN (
          SELECT COALESCE(
            NULLIF(trim(p.company_name), ''),
            NULLIF(trim(p.display_name), '')
          )
          FROM public.profiles p
          WHERE p.id = o.owner_id
          LIMIT 1
        )
        ELSE NULL
      END
    )
  INTO v_name
  FROM public.organizations o
  WHERE o.id = v_other;

  RETURN NULLIF(trim(COALESCE(v_name, '')), '');
END;
$$;

REVOKE ALL ON FUNCTION public.get_b2b_counterparty_org_name(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_b2b_counterparty_org_name(uuid, uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.get_b2b_counterparty_org_name(uuid, uuid, uuid) IS
  'Returns the counterparty organization display name for a B2B thread (client org ↔ agency org). Caller must be a member of p_viewer_org_id.';

-- ---------------------------------------------------------------------------
-- Defaults: avoid literal "Organization" / empty generic agency label in organizations.name
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_agency_organization(p_agency_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  oid uuid;
  aname text;
  aemail text;
  pemail text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  SELECT p.email INTO pemail FROM public.profiles p WHERE p.id = auth.uid();
  SELECT a.name, a.email INTO aname, aemail FROM public.agencies a WHERE a.id = p_agency_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'agency not found';
  END IF;
  IF lower(trim(COALESCE(pemail, ''))) IS DISTINCT FROM lower(trim(COALESCE(aemail, ''))) THEN
    RAISE EXCEPTION 'only agency master (email match) can bootstrap organization';
  END IF;
  IF (SELECT role FROM public.profiles WHERE id = auth.uid()) IS DISTINCT FROM 'agent' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT o.id INTO oid FROM public.organizations o WHERE o.agency_id = p_agency_id LIMIT 1;
  IF oid IS NOT NULL THEN
    RETURN oid;
  END IF;

  INSERT INTO public.organizations (name, type, owner_id, agency_id)
  VALUES (COALESCE(NULLIF(trim(aname), ''), 'Agency workspace'), 'agency', auth.uid(), p_agency_id)
  RETURNING id INTO oid;

  INSERT INTO public.organization_members (user_id, organization_id, role)
  VALUES (auth.uid(), oid, 'owner');

  RETURN oid;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_client_organization()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  oid uuid;
  oname text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF (SELECT role FROM public.profiles WHERE id = auth.uid()) IS DISTINCT FROM 'client' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT o.id INTO oid
  FROM public.organizations o
  WHERE o.owner_id = auth.uid() AND o.type = 'client'
  LIMIT 1;
  IF oid IS NOT NULL THEN
    RETURN oid;
  END IF;

  SELECT COALESCE(
    NULLIF(trim(company_name), ''),
    NULLIF(trim(display_name), ''),
    'Client workspace'
  )
  INTO oname
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

-- ---------------------------------------------------------------------------
-- Backfill: replace legacy placeholder org names where we can derive a better label
-- ---------------------------------------------------------------------------
UPDATE public.organizations o
SET name = sub.n
FROM (
  SELECT
    o2.id,
    COALESCE(
      NULLIF(trim(p.company_name), ''),
      NULLIF(trim(p.display_name), ''),
      'Client workspace'
    ) AS n
  FROM public.organizations o2
  JOIN public.profiles p ON p.id = o2.owner_id
  WHERE o2.type = 'client'
    AND trim(o2.name) IN ('Organization', '')
) sub
WHERE o.id = sub.id;

UPDATE public.organizations o
SET name = COALESCE(NULLIF(trim(a.name), ''), 'Agency workspace')
FROM public.agencies a
WHERE o.agency_id = a.id
  AND o.type = 'agency'
  AND (
    trim(COALESCE(o.name, '')) = ''
    OR trim(o.name) = 'Agency'
  );
