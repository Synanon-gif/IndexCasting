-- migration_organizations_column_security.sql
-- Tightens the organizations UPDATE policy so that only the `name` column
-- can be changed by the organization owner.
-- Replaces the broad UPDATE policy from migration_organizations_owner_can_update_name.sql.

-- Revoke broad UPDATE permission on organizations from authenticated users
-- (PostgREST/Supabase uses column-level grants to restrict which columns can be written).
REVOKE UPDATE ON public.organizations FROM authenticated;

-- Grant UPDATE only on the `name` column to authenticated users.
-- The RLS policy below further restricts this to owners only.
GRANT UPDATE (name) ON public.organizations TO authenticated;

-- Replace the existing owner UPDATE policy with an explicit column-restricted version.
DROP POLICY IF EXISTS organizations_update_owner ON public.organizations;
DROP POLICY IF EXISTS "Owner can update organization name" ON public.organizations;

CREATE POLICY "Owner can update organization name"
  ON public.organizations
  FOR UPDATE
  TO authenticated
  USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = organizations.id
        AND om.user_id = auth.uid()
        AND om.role = 'owner'
    )
  )
  WITH CHECK (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = organizations.id
        AND om.user_id = auth.uid()
        AND om.role = 'owner'
    )
  );
