-- =============================================================================
-- 2026-04-28: agency_invitations INSERT — remove profiles.role = 'agent' (P3)
-- Aligns with 20260426_remediation_three_policies_no_profiles_rls.sql (SELECT/UPDATE).
-- Does not touch other invitation policies. Not on profiles/models login path.
-- =============================================================================

DROP POLICY IF EXISTS "Agents can insert own agency invitations" ON public.agency_invitations;

CREATE POLICY "Agents can insert own agency invitations"
  ON public.agency_invitations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (
      EXISTS (
        SELECT 1
        FROM public.organizations o
        JOIN public.organization_members om ON om.organization_id = o.id
        WHERE o.type = 'agency'::organization_type
          AND om.user_id = auth.uid()
          AND om.role = ANY (
            ARRAY[
              'owner'::org_member_role,
              'booker'::org_member_role,
              'employee'::org_member_role
            ]
          )
      )
      OR EXISTS (
        SELECT 1
        FROM public.organizations o
        WHERE o.type = 'agency'::organization_type
          AND o.owner_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1
        FROM public.bookers b
        WHERE b.user_id = auth.uid()
      )
    )
    AND agency_id IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.agencies ag
        JOIN public.organizations o ON o.agency_id = ag.id
        JOIN public.organization_members om ON om.organization_id = o.id
        WHERE ag.id = agency_invitations.agency_id
          AND om.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1
        FROM public.agencies ag
        JOIN public.organizations o ON o.agency_id = ag.id
        WHERE ag.id = agency_invitations.agency_id
          AND o.owner_id = auth.uid()
      )
    )
  );

COMMENT ON POLICY "Agents can insert own agency invitations" ON public.agency_invitations IS
  'INSERT: agency-side caller via org_members / agency org owner / bookers — no profiles.role. 20260428.';
