-- M3: Add legacy bookers fallback to agency_event_groups RLS policies.
-- Matches the guard pattern used in agency_create_option_request and
-- agency_confirm_job_agency_only RPCs.

DROP POLICY IF EXISTS "agency_event_groups_select" ON public.agency_event_groups;
CREATE POLICY "agency_event_groups_select"
  ON public.agency_event_groups
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organization_members om
      JOIN public.organizations o ON o.id = om.organization_id
      WHERE om.user_id = auth.uid()
        AND o.agency_id = agency_event_groups.agency_id::uuid
        AND o.type = 'agency'
    )
    OR EXISTS (
      SELECT 1 FROM public.bookers b
      WHERE b.agency_id::text = agency_event_groups.agency_id
        AND b.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "agency_event_groups_insert" ON public.agency_event_groups;
CREATE POLICY "agency_event_groups_insert"
  ON public.agency_event_groups
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.organization_members om
      JOIN public.organizations o ON o.id = om.organization_id
      WHERE om.user_id = auth.uid()
        AND o.agency_id = agency_event_groups.agency_id::uuid
        AND o.type = 'agency'
    )
    OR EXISTS (
      SELECT 1 FROM public.bookers b
      WHERE b.agency_id::text = agency_event_groups.agency_id
        AND b.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "agency_event_groups_update" ON public.agency_event_groups;
CREATE POLICY "agency_event_groups_update"
  ON public.agency_event_groups
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organization_members om
      JOIN public.organizations o ON o.id = om.organization_id
      WHERE om.user_id = auth.uid()
        AND o.agency_id = agency_event_groups.agency_id::uuid
        AND o.type = 'agency'
    )
    OR EXISTS (
      SELECT 1 FROM public.bookers b
      WHERE b.agency_id::text = agency_event_groups.agency_id
        AND b.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "agency_event_groups_delete" ON public.agency_event_groups;
CREATE POLICY "agency_event_groups_delete"
  ON public.agency_event_groups
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organization_members om
      JOIN public.organizations o ON o.id = om.organization_id
      WHERE om.user_id = auth.uid()
        AND o.agency_id = agency_event_groups.agency_id::uuid
        AND o.type = 'agency'
    )
    OR EXISTS (
      SELECT 1 FROM public.bookers b
      WHERE b.agency_id::text = agency_event_groups.agency_id
        AND b.user_id = auth.uid()
    )
  );
