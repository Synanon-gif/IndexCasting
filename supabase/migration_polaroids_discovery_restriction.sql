-- =============================================================================
-- Polaroid Discovery Restriction
--
-- Polaroids are ONLY accessible to clients inside packages (guest links).
-- They must NEVER appear on the general discovery page or direct model queries.
--
-- Changes:
--   1) Client SELECT on model_photos: add photo_type != 'polaroid' guard
--   2) Anon SELECT on model_photos: same guard
--
-- Polaroids remain accessible via the get_guest_link_models SECURITY DEFINER
-- RPC, which already respects the include_polaroids flag on the guest_link row.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Authenticated non-agency clients: no polaroids, no private photos
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Clients see visible non-private model photos" ON public.model_photos;
DROP POLICY IF EXISTS "Clients see visible portfolio photos only" ON public.model_photos;

CREATE POLICY "Clients see visible portfolio photos only"
  ON public.model_photos FOR SELECT
  TO authenticated
  USING (
    is_visible_to_clients = true
    AND photo_type = 'portfolio'
  );

-- ---------------------------------------------------------------------------
-- 2) Anon (guest links / public pages): no polaroids, no private photos
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Anon sees visible non-private model photos" ON public.model_photos;
DROP POLICY IF EXISTS "Anon sees visible portfolio photos only" ON public.model_photos;

CREATE POLICY "Anon sees visible portfolio photos only"
  ON public.model_photos FOR SELECT
  TO anon
  USING (
    is_visible_to_clients = true
    AND photo_type = 'portfolio'
  );

-- Agency members keep full SELECT (all photo types) — policy unchanged.
-- Polaroids in packages are served exclusively via get_guest_link_models RPC
-- (SECURITY DEFINER, reads models.polaroids which is populated by syncPolaroidsToModel).
