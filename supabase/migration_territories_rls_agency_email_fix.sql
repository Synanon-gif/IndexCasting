-- =============================================================================
-- Fix: model_agency_territories RLS — agencies can write via email OR org-membership
--
-- Problem: the previous RLS policy required organizations → organization_members
-- which many agency users do not have set up, silently blocking all writes.
--
-- Fix: allow writes when EITHER
--   (a) the authenticated user's email matches the agency's email (owner path), OR
--   (b) the user is an organization_member with role owner/booker (team path).
--
-- Unique constraint stays: UNIQUE(model_id, country_code) — one agency per country.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Ensure UNIQUE(model_id, country_code) is the active constraint
--    (idempotent: drops old 3-column constraint if present, re-adds 2-column)
-- ---------------------------------------------------------------------------
ALTER TABLE public.model_agency_territories
  DROP CONSTRAINT IF EXISTS model_agency_territories_unique_model_country_agency;

ALTER TABLE public.model_agency_territories
  DROP CONSTRAINT IF EXISTS model_agency_territories_unique_model_country;

ALTER TABLE public.model_agency_territories
  ADD CONSTRAINT model_agency_territories_unique_model_country
  UNIQUE (model_id, country_code);

-- ---------------------------------------------------------------------------
-- 2) Drop all existing manage/view policies and replace them
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Agencies can manage their territories"     ON public.model_agency_territories;
DROP POLICY IF EXISTS "Agencies can manage their territories v2"  ON public.model_agency_territories;
DROP POLICY IF EXISTS "Agencies can view their territories"       ON public.model_agency_territories;
DROP POLICY IF EXISTS "Clients can view model territories"        ON public.model_agency_territories;

-- ---------------------------------------------------------------------------
-- 3) Agency WRITE policy (INSERT / UPDATE / DELETE)
--    Passes when the current user is the agency owner (email match)
--    OR is an organization member with owner/booker role.
-- ---------------------------------------------------------------------------
CREATE POLICY "Agencies can manage their territories"
  ON public.model_agency_territories
  FOR ALL
  TO authenticated
  USING (
    -- (a) Direct owner: user's profile email matches the agency's email
    EXISTS (
      SELECT 1
      FROM public.agencies a
      JOIN public.profiles pr
        ON LOWER(TRIM(pr.email)) = LOWER(TRIM(a.email))
      WHERE a.id = model_agency_territories.agency_id
        AND pr.id = auth.uid()
    )
    OR
    -- (b) Team member: organisation member with owner/booker role
    EXISTS (
      SELECT 1
      FROM public.organizations o
      JOIN public.organization_members om ON om.organization_id = o.id
      WHERE o.type = 'agency'
        AND o.agency_id = model_agency_territories.agency_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'booker')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.agencies a
      JOIN public.profiles pr
        ON LOWER(TRIM(pr.email)) = LOWER(TRIM(a.email))
      WHERE a.id = model_agency_territories.agency_id
        AND pr.id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1
      FROM public.organizations o
      JOIN public.organization_members om ON om.organization_id = o.id
      WHERE o.type = 'agency'
        AND o.agency_id = model_agency_territories.agency_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'booker')
    )
  );

-- ---------------------------------------------------------------------------
-- 4) Agency SELECT policy (read own territories in roster/settings)
-- ---------------------------------------------------------------------------
CREATE POLICY "Agencies can view their territories"
  ON public.model_agency_territories
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.agencies a
      JOIN public.profiles pr
        ON LOWER(TRIM(pr.email)) = LOWER(TRIM(a.email))
      WHERE a.id = model_agency_territories.agency_id
        AND pr.id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1
      FROM public.organizations o
      JOIN public.organization_members om ON om.organization_id = o.id
      WHERE o.type = 'agency'
        AND o.agency_id = model_agency_territories.agency_id
        AND om.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 5) Client SELECT policy (discovery + booking routing)
-- ---------------------------------------------------------------------------
CREATE POLICY "Clients can view model territories"
  ON public.model_agency_territories
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'client'
    )
  );
