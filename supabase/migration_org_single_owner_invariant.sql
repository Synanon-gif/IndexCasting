-- Exactly one row with role = owner per organization (organization_members).
-- Owner is always created by ensure_agency_organization / ensure_client_organization
-- for the first user who bootstraps that org (agency: profile email = agencies.email;
-- client: first ensure_client_organization for that user). Invites add booker/employee only.
--
-- Run in Supabase SQL Editor after migration_organizations_invitations_rls.sql.
-- If this fails, check for duplicate owners: 
--   SELECT organization_id, COUNT(*) FROM organization_members WHERE role = 'owner' GROUP BY 1 HAVING COUNT(*) > 1;

CREATE UNIQUE INDEX IF NOT EXISTS org_members_one_owner_per_organization
  ON public.organization_members (organization_id)
  WHERE role = 'owner';

COMMENT ON INDEX org_members_one_owner_per_organization IS
  'At most one owner membership row per organization; owner is the user who first bootstrapped the org via ensure_* RPC.';

-- --- RPC: Agency org — unchanged behaviour; comments clarify owner semantics ----------
COMMENT ON FUNCTION public.ensure_agency_organization(uuid) IS
  'Creates the agency organization row and a single owner membership for auth.uid(), only if profile email matches agencies.email (agency master / first activated account). Idempotent: returns existing org id.';

-- --- RPC: Client org — unchanged behaviour -------------------------------------------
COMMENT ON FUNCTION public.ensure_client_organization() IS
  'Creates the client organization and a single owner membership for auth.uid() on first call. One client org per owner user (organizations_one_client_owner). Invited employees get role employee via accept_organization_invitation.';

COMMENT ON FUNCTION public.accept_organization_invitation(text) IS
  'Adds booker or employee membership only; never creates a second owner.';
