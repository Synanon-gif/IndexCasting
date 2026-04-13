-- Agency-only grouped manual events (Option / Casting / Private).
CREATE TABLE IF NOT EXISTS public.agency_event_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id text NOT NULL,
  agency_organization_id uuid REFERENCES public.organizations(id),
  title text NOT NULL,
  event_date date NOT NULL,
  start_time text,
  end_time text,
  event_type text NOT NULL CHECK (event_type IN ('option','casting','private')),
  note text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.agency_event_groups ENABLE ROW LEVEL SECURITY;

-- Admin full access
CREATE POLICY "admin_full_access_agency_event_groups"
  ON public.agency_event_groups
  FOR ALL TO authenticated
  USING (public.is_current_user_admin())
  WITH CHECK (public.is_current_user_admin());

-- Agency org members: SELECT
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
  );

-- Agency org members: INSERT
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
  );

-- Agency org members: UPDATE
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
  );

-- Agency org members: DELETE
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
  );
