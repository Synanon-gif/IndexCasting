/*
  OBSOLETE — merged into migration_org_members_rls_no_recursion.sql

  The conversations_insert_creator policy here used EXISTS on organization_members and
  triggered the same RLS recursion as org_members_select.

  Run: migration_org_members_rls_no_recursion.sql (creates user_is_member_of_organization + both policies)
*/

SELECT 1 AS skip_obsolete_conversations_insert_b2b_org_member;
