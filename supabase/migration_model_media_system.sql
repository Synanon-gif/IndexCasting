-- =============================================================================
-- Model Media System
-- 1) Extend photo_type constraint to include 'private'
-- 2) Add agency_id to model_photos (nullable FK, for faster RLS queries)
-- 3) Add include_polaroids flag to guest_links
-- 4) Update RLS policies: private photos NEVER visible to clients or anon
-- 5) Update get_guest_link_models RPC to conditionally return polaroids
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Extend photo_type constraint: add 'private'
-- ---------------------------------------------------------------------------
ALTER TABLE public.model_photos
  DROP CONSTRAINT IF EXISTS model_photos_type_check;

ALTER TABLE public.model_photos
  ADD CONSTRAINT model_photos_type_check
  CHECK (photo_type IN ('portfolio', 'polaroid', 'private'));

-- ---------------------------------------------------------------------------
-- 2) Add agency_id to model_photos (nullable FK — backfilled via JOIN)
-- ---------------------------------------------------------------------------
ALTER TABLE public.model_photos
  ADD COLUMN IF NOT EXISTS agency_id UUID REFERENCES public.agencies(id) ON DELETE SET NULL;

-- Backfill agency_id from models table
UPDATE public.model_photos mp
SET agency_id = m.agency_id
FROM public.models m
WHERE m.id = mp.model_id
  AND mp.agency_id IS NULL;

-- Ensure private photos are ALWAYS hidden from clients (defensive backfill)
UPDATE public.model_photos
SET is_visible_to_clients = false
WHERE photo_type = 'private';

-- ---------------------------------------------------------------------------
-- 3) Add include_polaroids flag to guest_links
-- ---------------------------------------------------------------------------
ALTER TABLE public.guest_links
  ADD COLUMN IF NOT EXISTS include_polaroids BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- 4) Update RLS policies — private photos must NEVER be visible to clients
-- ---------------------------------------------------------------------------

-- Drop existing client-facing SELECT policies that lack the private guard
DROP POLICY IF EXISTS "Clients see visible model photos" ON public.model_photos;
DROP POLICY IF EXISTS "Anon can see visible model photos" ON public.model_photos;
DROP POLICY IF EXISTS "model_photos_select" ON public.model_photos;
DROP POLICY IF EXISTS "model_photos_select_anon" ON public.model_photos;

-- Authenticated non-agency users: only visible, non-private photos
CREATE POLICY "Clients see visible non-private model photos"
  ON public.model_photos FOR SELECT
  TO authenticated
  USING (
    is_visible_to_clients = true
    AND photo_type != 'private'
  );

-- Anon (guest links): only publicly visible, non-private photos
CREATE POLICY "Anon sees visible non-private model photos"
  ON public.model_photos FOR SELECT
  TO anon
  USING (
    is_visible_to_clients = true
    AND photo_type != 'private'
  );

-- Agency org members: full SELECT on all photo types (incl. private) for their models
-- "Agency members see own model photos" policy must still exist and match agency scope.
-- If it was dropped earlier, recreate it here:
DROP POLICY IF EXISTS "Agency members see own model photos" ON public.model_photos;
CREATE POLICY "Agency members see own model photos"
  ON public.model_photos FOR SELECT
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

-- Agency INSERT: members can insert photos for their models
DROP POLICY IF EXISTS "Agency members can insert model photos" ON public.model_photos;
CREATE POLICY "Agency members can insert model photos"
  ON public.model_photos FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.models m
      JOIN public.organizations o ON o.agency_id = m.agency_id
      JOIN public.organization_members om ON om.organization_id = o.id
      WHERE m.id = model_photos.model_id
        AND om.user_id = auth.uid()
    )
  );

-- Agency UPDATE: members can update photos for their models
DROP POLICY IF EXISTS "Agency members can update model photos" ON public.model_photos;
CREATE POLICY "Agency members can update model photos"
  ON public.model_photos FOR UPDATE
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

-- Agency DELETE: members can delete photos for their models
DROP POLICY IF EXISTS "Agency members can delete model photos" ON public.model_photos;
CREATE POLICY "Agency members can delete model photos"
  ON public.model_photos FOR DELETE
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

ALTER TABLE public.model_photos ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 5) Update get_guest_link_models RPC to conditionally include polaroids
-- ---------------------------------------------------------------------------
-- Must DROP first because the return type changes (new `polaroids` column).
DROP FUNCTION IF EXISTS public.get_guest_link_models(UUID);

CREATE OR REPLACE FUNCTION public.get_guest_link_models(p_link_id UUID)
RETURNS TABLE (
  id               UUID,
  name             TEXT,
  height           INTEGER,
  bust             INTEGER,
  waist            INTEGER,
  hips             INTEGER,
  city             TEXT,
  hair_color       TEXT,
  eye_color        TEXT,
  sex              TEXT,
  portfolio_images TEXT[],
  polaroids        TEXT[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_model_ids       UUID[];
  v_include_polars  BOOLEAN;
BEGIN
  -- Validate the link: must be active and not expired.
  SELECT gl.model_ids, gl.include_polaroids
    INTO v_model_ids, v_include_polars
    FROM public.guest_links gl
   WHERE gl.id        = p_link_id
     AND gl.is_active = true
     AND (gl.expires_at IS NULL OR gl.expires_at > now());

  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    m.id,
    m.name,
    m.height,
    m.bust,
    m.waist,
    m.hips,
    m.city,
    m.hair_color,
    m.eye_color,
    m.sex::TEXT,
    m.portfolio_images,
    CASE WHEN v_include_polars THEN COALESCE(m.polaroids, '{}') ELSE '{}' END
  FROM public.models m
  WHERE m.id = ANY(v_model_ids);
END;
$$;

-- Grant EXECUTE to both anon and authenticated roles.
GRANT EXECUTE ON FUNCTION public.get_guest_link_models(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.get_guest_link_models(UUID) TO authenticated;

COMMENT ON FUNCTION public.get_guest_link_models(UUID) IS
  'Returns model fields for an active guest link. Conditionally includes polaroids '
  'when include_polaroids = true on the link. Private photos are never exposed. '
  'SECURITY DEFINER — safe for anon callers, scoped strictly to the linked models.';
