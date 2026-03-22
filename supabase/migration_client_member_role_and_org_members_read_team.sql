-- Client org: RPC for UI role (parity with get_my_agency_member_role).
-- Team directory: any org member can list all members in their organization.

CREATE OR REPLACE FUNCTION public.get_my_client_member_role()
RETURNS TABLE(member_role text, organization_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.role::text, m.organization_id
  FROM public.organization_members m
  JOIN public.organizations o ON o.id = m.organization_id
  WHERE m.user_id = auth.uid()
    AND o.type = 'client'
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_my_client_member_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_client_member_role() TO authenticated;

-- Allow every member of an organization to see all members (team roster).
DROP POLICY IF EXISTS org_members_select ON public.organization_members;
CREATE POLICY org_members_select
  ON public.organization_members FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members m
      WHERE m.organization_id = organization_members.organization_id
        AND m.user_id = auth.uid()
    )
  );
