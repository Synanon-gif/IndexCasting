-- =============================================================================
-- model_photos — linked model self-read (portfolio + polaroids)
--
-- Background: Migration 20260817_polaroid_discovery_restriction_canonical.sql
-- replaced the authenticated client SELECT policy with a strict clause:
--   has_platform_access() AND caller_is_client_org_member()
--   AND photo_type = 'portfolio' AND is_visible_to_clients = true
--
-- That removed the implicit path where a linked model (models.user_id = auth.uid())
-- could read their rows via broader historical policies.
--
-- This policy restores a minimal SELECT path for linked models ONLY:
--   - rows for their models.id match
--   - photo_type portfolio or polaroid (never private/agency-internal)
--
-- Clients remain constrained by existing policies; agencies remain on their SELECT
-- path. No weakening of anon access or cross-model reads.
-- =============================================================================

DROP POLICY IF EXISTS "Models read own portfolio and polaroid photos" ON public.model_photos;

CREATE POLICY "Models read own portfolio and polaroid photos"
  ON public.model_photos
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.models m
      WHERE m.id = model_photos.model_id
        AND m.user_id = auth.uid()
    )
    AND model_photos.photo_type IN ('portfolio', 'polaroid')
  );

COMMENT ON POLICY "Models read own portfolio and polaroid photos" ON public.model_photos IS
  'Linked model reads own portfolio and polaroid model_photos rows; excludes photo_type '
  'private. Does not broaden client/org access.';
