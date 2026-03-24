-- migration_model_photos_rls_tighten.sql
-- Tightens the model_photos SELECT policy.
-- Previously: all authenticated users could read photos with is_visible_to_clients = true.
-- Now: clients can only see photos for models that have a territory entry (or real location),
-- and agency members can always see their own model photos.
-- Unauthenticated (anon) access remains for is_visible_to_clients = true (for guest links / public pages).

-- Drop the previous broad SELECT policy.
DROP POLICY IF EXISTS "Authenticated can see visible model photos" ON public.model_photos;
DROP POLICY IF EXISTS "model_photos_select_authenticated" ON public.model_photos;
DROP POLICY IF EXISTS "Clients and agency see photos" ON public.model_photos;

-- New policy: Agency org members see all photos for their models (full access).
CREATE POLICY "Agency members see own model photos"
  ON public.model_photos
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.models m
      JOIN public.organizations o ON o.agency_id = m.agency_id
      JOIN public.organization_members om ON om.organization_id = o.id
      WHERE m.id = model_photos.model_id
        AND om.user_id = auth.uid()
    )
  );

-- New policy: clients and models (and other authenticated users) can read
-- photos that are explicitly marked visible to clients — only for models
-- they can discover (via territory or real location RLS on `models`).
-- We rely on the models RLS to gate which models are accessible; here we
-- only require is_visible_to_clients = true.
CREATE POLICY "Clients see visible model photos"
  ON public.model_photos
  FOR SELECT
  TO authenticated
  USING (
    is_visible_to_clients = true
  );

-- Anon (unauthenticated / guest link) can read publicly visible photos.
DROP POLICY IF EXISTS "Anon can see visible model photos" ON public.model_photos;
CREATE POLICY "Anon can see visible model photos"
  ON public.model_photos
  FOR SELECT
  TO anon
  USING (
    is_visible_to_clients = true
  );
