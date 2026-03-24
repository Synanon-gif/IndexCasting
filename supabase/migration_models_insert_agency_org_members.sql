-- Allow agency owners/bookers to create models under their own agency.
-- Required for "Add Model Manually" in AgencyControllerView.
-- Run after organizations + organization_members migrations.

ALTER TABLE public.models ENABLE ROW LEVEL SECURITY;

-- Keep existing SELECT policies.
-- Tighten/update UPDATE policy and add explicit INSERT policy for org members.
DROP POLICY IF EXISTS "Agency can update own models" ON public.models;
DROP POLICY IF EXISTS "models_update_agency_org_members" ON public.models;
DROP POLICY IF EXISTS "models_insert_agency_org_members" ON public.models;

CREATE POLICY "models_update_agency_org_members"
  ON public.models
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organizations o
      JOIN public.organization_members om ON om.organization_id = o.id
      WHERE o.type = 'agency'
        AND o.agency_id = models.agency_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'booker')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.organizations o
      JOIN public.organization_members om ON om.organization_id = o.id
      WHERE o.type = 'agency'
        AND o.agency_id = models.agency_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'booker')
    )
  );

CREATE POLICY "models_insert_agency_org_members"
  ON public.models
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.organizations o
      JOIN public.organization_members om ON om.organization_id = o.id
      WHERE o.type = 'agency'
        AND o.agency_id = models.agency_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'booker')
    )
  );
