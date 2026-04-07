-- =============================================================================
-- Remediation (2026-04-26): Remove profiles.role from 3 live-confirmed RLS policies
-- =============================================================================

DROP POLICY IF EXISTS "Agents can read own agency invitations" ON public.agency_invitations;

CREATE POLICY "Agents can read own agency invitations"
  ON public.agency_invitations FOR SELECT TO authenticated
  USING (
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
    AND (
      (
        agency_id IS NOT NULL
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
      )
      OR agency_id IS NULL
    )
  );

COMMENT ON POLICY "Agents can read own agency invitations" ON public.agency_invitations IS
  'Agency-side callers via org membership / agency org owner / bookers — no profiles.role. 20260426 remediation.';

DROP POLICY IF EXISTS "Agents can update own agency invitations" ON public.agency_invitations;

CREATE POLICY "Agents can update own agency invitations"
  ON public.agency_invitations
  FOR UPDATE
  TO authenticated
  USING (
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
  )
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

COMMENT ON POLICY "Agents can update own agency invitations" ON public.agency_invitations IS
  'UPDATE WITH CHECK mirrors USING; agency-side caller without profiles.role. 20260426 remediation.';

DROP POLICY IF EXISTS "Clients see visible model photos" ON public.model_photos;

CREATE POLICY "Clients see visible model photos"
  ON public.model_photos FOR SELECT TO authenticated
  USING (
    is_visible_to_clients = true
    AND public.has_platform_access()
    AND public.caller_is_client_org_member()
  );

COMMENT ON POLICY "Clients see visible model photos" ON public.model_photos IS
  'Paywall + caller_is_client_org_member() — no profiles.role. 20260426 remediation.';
