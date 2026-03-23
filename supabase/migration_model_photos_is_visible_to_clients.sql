-- =============================================================================
-- Photos visibility: introduce is_visible_to_clients (per-image client access)
-- - Adds column `is_visible_to_clients` default true (NOT NULL)
-- - Backfills from legacy `visible`
-- - Updates RLS policies so SELECT uses is_visible_to_clients
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Column + backfill
-- ---------------------------------------------------------------------------
ALTER TABLE public.model_photos
  ADD COLUMN IF NOT EXISTS is_visible_to_clients BOOLEAN;

-- Backfill existing rows to preserve behavior (legacy `visible` = client visibility)
UPDATE public.model_photos
SET is_visible_to_clients = visible
WHERE visible IS NOT NULL;

ALTER TABLE public.model_photos
  ALTER COLUMN is_visible_to_clients SET DEFAULT true;

ALTER TABLE public.model_photos
  ALTER COLUMN is_visible_to_clients SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 2) RLS policies: clients only see is_visible_to_clients=true
-- ---------------------------------------------------------------------------
-- Phase 13 policy name
DROP POLICY IF EXISTS "Anyone can view visible photos" ON public.model_photos;
-- Org-based policy names (phase 13/14)
DROP POLICY IF EXISTS "model_photos_select" ON public.model_photos;
DROP POLICY IF EXISTS "model_photos_select_anon" ON public.model_photos;

CREATE POLICY "model_photos_select"
  ON public.model_photos FOR SELECT
  TO authenticated
  USING (
    is_visible_to_clients = true
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
  USING (is_visible_to_clients = true);

-- Ensure table has RLS enabled (it should already)
ALTER TABLE public.model_photos ENABLE ROW LEVEL SECURITY;

