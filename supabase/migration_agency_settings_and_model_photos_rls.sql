-- Agency public profile fields + owner-only updates on agencies / agency organizations.
-- model_photos: replace legacy email-based agency policy with organization_members (Owner + Bookers).
-- Run in Supabase SQL Editor after migration_organizations_invitations_rls.sql and migration_org_members_rls_no_recursion.sql.

-- ---------------------------------------------------------------------------
-- agencies: extended fields (English UI; stored as plain text / text[])
-- ---------------------------------------------------------------------------
ALTER TABLE public.agencies
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS website TEXT,
  ADD COLUMN IF NOT EXISTS street TEXT,
  ADD COLUMN IF NOT EXISTS country TEXT,
  ADD COLUMN IF NOT EXISTS agency_types TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.agencies.agency_types IS 'Marketing segments: Fashion, High Fashion, Commercial (multi-select).';

-- ---------------------------------------------------------------------------
-- agencies RLS: allow agency organization owners to UPDATE their row
-- (Keep service_role full access.)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Only service role can modify agencies" ON public.agencies;
DROP POLICY IF EXISTS "service_role_agencies_all" ON public.agencies;
DROP POLICY IF EXISTS "agency_org_owner_can_update_agency" ON public.agencies;

CREATE POLICY "service_role_agencies_all"
  ON public.agencies FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "agency_org_owner_can_update_agency"
  ON public.agencies FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organizations o
      JOIN public.organization_members m ON m.organization_id = o.id
      WHERE o.type = 'agency'
        AND o.agency_id = agencies.id
        AND m.user_id = auth.uid()
        AND m.role = 'owner'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.organizations o
      JOIN public.organization_members m ON m.organization_id = o.id
      WHERE o.type = 'agency'
        AND o.agency_id = agencies.id
        AND m.user_id = auth.uid()
        AND m.role = 'owner'
    )
  );

-- ---------------------------------------------------------------------------
-- organizations: agency owners may update workspace name (kept in sync with agencies.name in app)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "agency_org_owner_can_update_org" ON public.organizations;

CREATE POLICY "agency_org_owner_can_update_org"
  ON public.organizations FOR UPDATE
  TO authenticated
  USING (
    type = 'agency'
    AND EXISTS (
      SELECT 1
      FROM public.organization_members m
      WHERE m.organization_id = organizations.id
        AND m.user_id = auth.uid()
        AND m.role = 'owner'
    )
  )
  WITH CHECK (
    type = 'agency'
    AND EXISTS (
      SELECT 1
      FROM public.organization_members m
      WHERE m.organization_id = organizations.id
        AND m.user_id = auth.uid()
        AND m.role = 'owner'
    )
  );

-- ---------------------------------------------------------------------------
-- model_photos: org-based access (Owner + Bookers); clients see visible rows only
-- ---------------------------------------------------------------------------
ALTER TABLE public.model_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view visible photos" ON public.model_photos;
DROP POLICY IF EXISTS "Agency can manage model photos" ON public.model_photos;
DROP POLICY IF EXISTS "model_photos_select" ON public.model_photos;
DROP POLICY IF EXISTS "model_photos_select_anon" ON public.model_photos;
DROP POLICY IF EXISTS "model_photos_insert_agency" ON public.model_photos;
DROP POLICY IF EXISTS "model_photos_update_agency" ON public.model_photos;
DROP POLICY IF EXISTS "model_photos_delete_agency" ON public.model_photos;

CREATE POLICY "model_photos_select"
  ON public.model_photos FOR SELECT
  TO authenticated
  USING (
    visible = true
    OR EXISTS (
      SELECT 1
      FROM public.models m
      JOIN public.organizations o ON o.agency_id = m.agency_id AND o.type = 'agency'
      JOIN public.organization_members om ON om.organization_id = o.id
      WHERE m.id = model_photos.model_id
        AND om.user_id = auth.uid()
    )
  );

CREATE POLICY "model_photos_select_anon"
  ON public.model_photos FOR SELECT
  TO anon
  USING (visible = true);

CREATE POLICY "model_photos_insert_agency"
  ON public.model_photos FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.models m
      JOIN public.organizations o ON o.agency_id = m.agency_id AND o.type = 'agency'
      JOIN public.organization_members om ON om.organization_id = o.id
      WHERE m.id = model_photos.model_id
        AND om.user_id = auth.uid()
    )
  );

CREATE POLICY "model_photos_update_agency"
  ON public.model_photos FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.models m
      JOIN public.organizations o ON o.agency_id = m.agency_id AND o.type = 'agency'
      JOIN public.organization_members om ON om.organization_id = o.id
      WHERE m.id = model_photos.model_id
        AND om.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.models m
      JOIN public.organizations o ON o.agency_id = m.agency_id AND o.type = 'agency'
      JOIN public.organization_members om ON om.organization_id = o.id
      WHERE m.id = model_photos.model_id
        AND om.user_id = auth.uid()
    )
  );

CREATE POLICY "model_photos_delete_agency"
  ON public.model_photos FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.models m
      JOIN public.organizations o ON o.agency_id = m.agency_id AND o.type = 'agency'
      JOIN public.organization_members om ON om.organization_id = o.id
      WHERE m.id = model_photos.model_id
        AND om.user_id = auth.uid()
    )
  );
