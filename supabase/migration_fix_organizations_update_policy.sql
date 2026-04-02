-- =============================================================================
-- Fix: organizations UPDATE-Policies konsolidieren
--
-- Problem: Mindestens zwei konkurrierende UPDATE-Policies auf organizations:
--   1. "Owner can update organization name" (nur Owner, nur name)
--   2. "org_member_can_update_org_settings" (Owner + Booker/Employee, breiter)
--
-- Zielzustand laut Role-Permission-Model:
--   Agency-Org: owner + booker dürfen Settings (inkl. name) updaten
--   Client-Org:  owner + employee dürfen Settings (inkl. name) updaten
--   Owner-exclusive: Delete, Billing, Invite — nicht hier betroffen
--
-- Zusätzlich: Veraltete "no_mutate/no_update/no_delete"-Policies auf
-- organization_members bereinigen (werden von den neuen Policies aus
-- migration_org_role_type_enforcement.sql ersetzt).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. organizations: alte konkurrierende UPDATE-Policies droppen
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS "Owner can update organization name" ON public.organizations;
DROP POLICY IF EXISTS org_member_can_update_org_settings ON public.organizations;

-- -----------------------------------------------------------------------------
-- 2. organizations: einzige konsolidierte UPDATE-Policy
--    (admin_update_org_all bleibt erhalten)
-- -----------------------------------------------------------------------------

CREATE POLICY organizations_update
  ON public.organizations FOR UPDATE
  TO authenticated
  USING (
    check_org_access(id, 'agency', ARRAY['owner', 'booker']::org_member_role[])
    OR check_org_access(id, 'client', ARRAY['owner', 'employee']::org_member_role[])
  )
  WITH CHECK (
    check_org_access(id, 'agency', ARRAY['owner', 'booker']::org_member_role[])
    OR check_org_access(id, 'client', ARRAY['owner', 'employee']::org_member_role[])
  );

-- -----------------------------------------------------------------------------
-- 3. organization_members: veraltete "deny-all"-Policies bereinigen
--    Diese werden von den neuen Policies aus migration_org_role_type_enforcement
--    vollständig ersetzt und sind nur noch tote Cruft.
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS org_members_no_mutate  ON public.organization_members;
DROP POLICY IF EXISTS org_members_no_update  ON public.organization_members;
DROP POLICY IF EXISTS org_members_no_delete  ON public.organization_members;
