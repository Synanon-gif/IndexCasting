-- Expand settings permissions:
-- - Agency: owner + booker can manage agency settings/invitations
-- - Client: owner + employee can manage client settings/invitations
-- - Organization members list visible to all members of the same org

-- ---------------------------------------------------------------------------
-- 1) organization_members SELECT: all members of same org can see member list
-- ---------------------------------------------------------------------------
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

-- recursion-safe helper
CREATE OR REPLACE FUNCTION public.user_is_member_of_organization(p_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members m
    WHERE m.organization_id = p_organization_id
      AND m.user_id = auth.uid()
  );
$$;

ALTER FUNCTION public.user_is_member_of_organization(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.user_is_member_of_organization(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_is_member_of_organization(uuid) TO authenticated;

DROP POLICY IF EXISTS org_members_select ON public.organization_members;
CREATE POLICY org_members_select
  ON public.organization_members FOR SELECT
  TO authenticated
  USING (public.user_is_member_of_organization(organization_id));

-- ---------------------------------------------------------------------------
-- 2) agencies UPDATE: allow owner + booker of agency organization
-- ---------------------------------------------------------------------------
ALTER TABLE public.agencies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agency_org_owner_can_update_agency" ON public.agencies;
DROP POLICY IF EXISTS "agency_org_member_can_update_agency" ON public.agencies;

CREATE POLICY "agency_org_member_can_update_agency"
  ON public.agencies FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organizations o
      JOIN public.organization_members m ON m.organization_id = o.id
      WHERE o.type = 'agency'
        AND o.agency_id = agencies.id
        AND m.user_id = auth.uid()
        AND m.role IN ('owner', 'booker')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.organizations o
      JOIN public.organization_members m ON m.organization_id = o.id
      WHERE o.type = 'agency'
        AND o.agency_id = agencies.id
        AND m.user_id = auth.uid()
        AND m.role IN ('owner', 'booker')
    )
  );

-- ---------------------------------------------------------------------------
-- 3) organizations UPDATE:
--    - agency orgs: owner + booker
--    - client orgs: owner + employee
-- ---------------------------------------------------------------------------
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agency_org_owner_can_update_org" ON public.organizations;
DROP POLICY IF EXISTS "org_member_can_update_org_settings" ON public.organizations;

CREATE POLICY "org_member_can_update_org_settings"
  ON public.organizations FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organization_members m
      WHERE m.organization_id = organizations.id
        AND m.user_id = auth.uid()
        AND (
          (organizations.type = 'agency' AND m.role IN ('owner', 'booker'))
          OR
          (organizations.type = 'client' AND m.role IN ('owner', 'employee'))
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.organization_members m
      WHERE m.organization_id = organizations.id
        AND m.user_id = auth.uid()
        AND (
          (organizations.type = 'agency' AND m.role IN ('owner', 'booker'))
          OR
          (organizations.type = 'client' AND m.role IN ('owner', 'employee'))
        )
    )
  );

-- ---------------------------------------------------------------------------
-- 4) invitations SELECT/INSERT:
--    - agency org: owner + booker
--    - client org: owner + employee
-- ---------------------------------------------------------------------------
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invitations_select_owner ON public.invitations;
DROP POLICY IF EXISTS invitations_insert_owner ON public.invitations;
DROP POLICY IF EXISTS invitations_select_org_settings_members ON public.invitations;
DROP POLICY IF EXISTS invitations_insert_org_settings_members ON public.invitations;

CREATE POLICY invitations_select_org_settings_members
  ON public.invitations FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organizations o
      JOIN public.organization_members m ON m.organization_id = o.id
      WHERE o.id = invitations.organization_id
        AND m.user_id = auth.uid()
        AND (
          (o.type = 'agency' AND m.role IN ('owner', 'booker'))
          OR
          (o.type = 'client' AND m.role IN ('owner', 'employee'))
        )
    )
  );

CREATE POLICY invitations_insert_org_settings_members
  ON public.invitations FOR INSERT
  TO authenticated
  WITH CHECK (
    invited_by = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.organizations o
      JOIN public.organization_members m ON m.organization_id = o.id
      WHERE o.id = organization_id
        AND m.user_id = auth.uid()
        AND (
          (o.type = 'agency' AND m.role IN ('owner', 'booker'))
          OR
          (o.type = 'client' AND m.role IN ('owner', 'employee'))
        )
    )
  );
