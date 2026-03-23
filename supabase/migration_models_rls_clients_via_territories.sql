-- =============================================================================
-- RLS Stabilization for `models`:
-- - Clients: can SELECT only models that have at least one territory row
-- - Models: can SELECT their own row (user_id = auth.uid())
-- - Agencies: can SELECT models managed by their agency organization
-- =============================================================================

ALTER TABLE public.models ENABLE ROW LEVEL SECURITY;

-- Remove overly broad SELECT for authenticated users (from base schema.sql).
DROP POLICY IF EXISTS "Anyone authenticated can read visible models" ON public.models;

-- Clients can only see models that are represented somewhere (via territories).
CREATE POLICY "Clients can read represented visible models"
  ON public.models FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'client'
    )
    AND (models.is_visible_commercial = true OR models.is_visible_fashion = true)
    AND EXISTS (
      SELECT 1
      FROM public.model_agency_territories mat
      WHERE mat.model_id = models.id
    )
  );

-- Models can only access their own data.
CREATE POLICY "Models can read own model"
  ON public.models FOR SELECT
  TO authenticated
  USING (
    models.user_id = auth.uid()
  );

-- Agency members can read only the models belonging to their agency.
CREATE POLICY "Agencies can read own agency models"
  ON public.models FOR SELECT
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
  );

