-- Fix: (1) infinite recursion on organization_members RLS
--     (2) conversations INSERT failing: SECURITY DEFINER still applied RLS to inner SELECT in PG15+
--         unless row_security is off for that function.
--
-- Two permissive INSERT policies on conversations: OR semantics — pass if you are in participant_ids
-- OR you are a verified org member for the B2B pair.
--
-- Run in SQL Editor. Safe to re-run.

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

-- Team roster: any member sees all rows for orgs they belong to (no self-join under RLS).
DROP POLICY IF EXISTS org_members_select ON public.organization_members;

CREATE POLICY org_members_select
  ON public.organization_members FOR SELECT
  TO authenticated
  USING (public.user_is_member_of_organization(organization_id));

-- Conversations: permissive INSERT policies (combined with OR).
DROP POLICY IF EXISTS "conversations_insert_creator" ON public.conversations;
DROP POLICY IF EXISTS "conversations_insert_participant" ON public.conversations;
DROP POLICY IF EXISTS "conversations_insert_b2b_org_scoped" ON public.conversations;

CREATE POLICY "conversations_insert_participant"
  ON public.conversations FOR INSERT TO authenticated
  WITH CHECK (
    (created_by IS NULL OR created_by = auth.uid())
    AND auth.uid() = ANY (participant_ids)
  );

CREATE POLICY "conversations_insert_b2b_org_scoped"
  ON public.conversations FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND client_organization_id IS NOT NULL
    AND agency_organization_id IS NOT NULL
    AND (
      public.user_is_member_of_organization(client_organization_id)
      OR public.user_is_member_of_organization(agency_organization_id)
    )
  );
