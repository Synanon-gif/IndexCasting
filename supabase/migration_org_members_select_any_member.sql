/*
  OBSOLETE — replaced by migration_org_members_rls_no_recursion.sql

  The previous policy used EXISTS (SELECT … FROM organization_members …), which caused
  infinite RLS recursion on organization_members.

  Run: migration_org_members_rls_no_recursion.sql
*/

SELECT 1 AS skip_obsolete_org_members_select_any_member;
